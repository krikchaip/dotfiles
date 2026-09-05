import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  cleanupRun,
  makeRunDirectory,
  PiTuiHarness,
} from "../../../../extensions/test/e2e/harness.ts";

const root = resolve(import.meta.dir, "../../../..");
const runDirectory = makeRunDirectory(root);
const childCount = 8;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function filesNamed(directory: string, name: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? filesNamed(path, name)
      : entry.name === name
        ? [path]
        : [];
  });
}

function providerResponse(index: number): Response {
  const chunks = [
    {
      id: `collision-${index}`,
      object: "chat.completion.chunk",
      created: 1_767_225_600,
      model: "fake",
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            content: `COLLISION_PROVIDER_REACHED_${index}`,
          },
          finish_reason: null,
        },
      ],
    },
    {
      id: `collision-${index}`,
      object: "chat.completion.chunk",
      created: 1_767_225_600,
      model: "fake",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    },
  ];
  return new Response(
    `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      return new Response("Not found", { status: 404 });
    }
    const payload = (await request.json()) as { collisionIndex?: number };
    return providerResponse(payload.collisionIndex ?? -1);
  },
});

try {
  const providerUrl = new URL("/v1", server.url).toString().replace(/\/$/, "");
  const sharedHome = join(runDirectory, "shared-home");
  const harnesses = await Promise.all(
    Array.from({ length: childCount }, (_, index) =>
      PiTuiHarness.start({
        name: `payload-collision-${index}`,
        root,
        runDirectory,
        extensions: [
          "packages/provider-payload-debug/test/e2e/provider.ts",
          "packages/provider-payload-debug/test/e2e/fixture/collision-prepare.ts",
          "packages/provider-payload-debug",
          "packages/provider-payload-debug/test/e2e/fixture/collision-restore.ts",
        ],
        model: "provider-payload-debug-e2e/fake",
        cliArguments: ["--provider-payload-debug"],
        environment: {
          HOME: sharedHome,
          PROVIDER_PAYLOAD_DEBUG_COLLISION_INDEX: String(index),
          PROVIDER_PAYLOAD_DEBUG_E2E_URL: providerUrl,
        },
        settings: { quietStartup: false, theme: "dark" },
      }),
    ),
  );

  await Promise.all(
    harnesses.map((harness, index) =>
      harness.submit(`capture from concurrent Pi process ${index}`),
    ),
  );
  await Promise.all(
    harnesses.map((harness, index) =>
      harness.waitFor(`COLLISION_PROVIDER_REACHED_${index}`, 12_000),
    ),
  );

  const debugDir = join(
    sharedHome,
    ".pi",
    "agent",
    "debug",
    "provider-payloads",
  );
  const summaries = filesNamed(debugDir, "summary.json");
  const payloads = filesNamed(debugDir, "payload.json");
  assert(
    summaries.length === childCount,
    `Expected ${childCount} summaries from concurrent processes, got ${summaries.length}.`,
  );
  assert(
    payloads.length === childCount,
    `Expected ${childCount} payloads from concurrent processes, got ${payloads.length}.`,
  );

  const requestDirectories = new Set(
    summaries.map((path) => resolve(path, "..")),
  );
  assert(
    requestDirectories.size === childCount,
    "Concurrent processes shared a request directory.",
  );
  const indexes = payloads
    .map((path) => JSON.parse(readFileSync(path, "utf8")).collisionIndex)
    .sort((left, right) => left - right);
  assert(
    JSON.stringify(indexes) ===
      JSON.stringify(Array.from({ length: childCount }, (_, index) => index)),
    `Concurrent payload contents were overwritten: ${JSON.stringify(indexes)}.`,
  );

  await Promise.all(harnesses.map((harness) => harness.finish()));
  console.log(
    `PASS provider-payload-debug collision real-PTY E2E: ${childCount} concurrent Pi processes kept distinct captures`,
  );
} finally {
  server.stop(true);
  await cleanupRun(runDirectory);
}
