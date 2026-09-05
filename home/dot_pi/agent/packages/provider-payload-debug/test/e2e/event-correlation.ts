import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  cleanupRun,
  makeRunDirectory,
  PiTuiHarness,
} from "../../../../extensions/test/e2e/harness.ts";

const root = resolve(import.meta.dir, "../../../..");
const runDirectory = makeRunDirectory(root);
let responseSequence = 0;

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

function providerResponse(): Response {
  responseSequence += 1;
  const sequence = responseSequence;
  const chunks = [
    {
      id: `lifecycle-${sequence}`,
      object: "chat.completion.chunk",
      created: 1_767_225_600,
      model: "fake",
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            content: `LIFECYCLE_CORRELATION_RESPONSE_${sequence}`,
          },
          finish_reason: null,
        },
      ],
    },
    {
      id: `lifecycle-${sequence}`,
      object: "chat.completion.chunk",
      created: 1_767_225_600,
      model: "fake",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    },
  ];
  return new Response(
    `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
    {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-e2e-response": String(sequence),
      },
    },
  );
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      return new Response("Not found", { status: 404 });
    }
    return providerResponse();
  },
});

try {
  const providerUrl = new URL("/v1", server.url).toString().replace(/\/$/, "");
  const harness = await PiTuiHarness.start({
    name: "payload-event-correlation",
    root,
    runDirectory,
    extensions: [
      "packages/provider-payload-debug/test/e2e/provider.ts",
      "packages/provider-payload-debug/test/e2e/fixture/lifecycle-probe.ts",
      "packages/provider-payload-debug",
    ],
    model: "provider-payload-debug-e2e/fake",
    persistSession: true,
    environment: { PROVIDER_PAYLOAD_DEBUG_E2E_URL: providerUrl },
    settings: { quietStartup: false, theme: "dark" },
  });

  await harness.waitFor("PROVIDER_PAYLOAD_DEBUG_SESSION_START_1");
  await harness.sendLiteral("/provider-payload-debug once");
  await harness.sendKeys("Escape", "Enter");
  await harness.waitFor("Next provider request will be captured");
  await harness.submit("capture before replacing the session");
  await harness.waitFor("LIFECYCLE_CORRELATION_RESPONSE_1");

  const debugDir = join(
    runDirectory,
    "payload-event-correlation-home",
    ".pi",
    "agent",
    "debug",
    "provider-payloads",
  );
  await harness.waitUntil(
    "first response metadata",
    () => filesNamed(debugDir, "response.json").length === 1,
  );
  const responsePath = filesNamed(debugDir, "response.json")[0]!;
  const first = JSON.parse(readFileSync(responsePath, "utf8"));
  assert(
    first.headers?.["x-e2e-response"] === "1",
    "First lifecycle response metadata is wrong.",
  );

  await harness.sendLiteral("/new");
  await harness.sendKeys("Escape", "Enter");
  await harness.waitFor("PROVIDER_PAYLOAD_DEBUG_SESSION_START_2");
  await harness.submit("uncaptured request after replacing the session");
  await harness.waitFor("LIFECYCLE_CORRELATION_RESPONSE_2");
  await Bun.sleep(300);

  const afterReplacement = JSON.parse(readFileSync(responsePath, "utf8"));
  assert(
    afterReplacement.headers?.["x-e2e-response"] === "1",
    "Correlation lifecycle handlers were not registered. Session replacement overwrote captured metadata.",
  );

  await harness.finish();
  console.log(
    "PASS provider-payload-debug lifecycle real-PTY E2E: session replacement clears response correlation state",
  );
} finally {
  server.stop(true);
  await cleanupRun(runDirectory);
}
