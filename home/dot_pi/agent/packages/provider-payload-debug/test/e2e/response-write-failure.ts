import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  cleanupRun,
  makeRunDirectory,
  PiTuiHarness,
} from "../../../../extensions/test/e2e/harness.ts";

const root = resolve(import.meta.dir, "../../../..");
const runDirectory = makeRunDirectory(root);
let requestCount = 0;
const debugDir = join(
  runDirectory,
  "payload-response-write-failure-home",
  ".pi",
  "agent",
  "debug",
  "provider-payloads",
);

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
  const summary = filesNamed(debugDir, "summary.json")[0];
  assert(summary, "Provider was called before its request summary was written.");
  mkdirSync(join(resolve(summary, ".."), "response.json"));

  const chunks = [
    {
      id: "response-write-failure",
      object: "chat.completion.chunk",
      created: 1_767_225_600,
      model: "fake",
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: "RESPONSE_WRITE_FAILURE_PROVIDER_REACHED" },
          finish_reason: null,
        },
      ],
    },
    {
      id: "response-write-failure",
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
  fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      return new Response("Not found", { status: 404 });
    }
    requestCount += 1;
    return providerResponse();
  },
});

try {
  const providerUrl = new URL("/v1", server.url).toString().replace(/\/$/, "");
  const harness = await PiTuiHarness.start({
    name: "payload-response-write-failure",
    root,
    runDirectory,
    extensions: [
      "packages/provider-payload-debug/test/e2e/provider.ts",
      "packages/provider-payload-debug",
    ],
    model: "provider-payload-debug-e2e/fake",
    cliArguments: ["--provider-payload-debug"],
    environment: { PROVIDER_PAYLOAD_DEBUG_E2E_URL: providerUrl },
    settings: { quietStartup: false, theme: "dark" },
  });

  await harness.submit("response metadata write must not break streaming");
  await harness.waitFor("RESPONSE_WRITE_FAILURE_PROVIDER_REACHED", 8_000);
  assert(requestCount === 1, `Expected one provider request, got ${requestCount}.`);
  const view = await harness.capture();
  const normalizedView = view.replace(/\s+/g, " ");
  const warning = "provider-payload-debug: response metadata write failed (EISDIR)";
  assert(
    normalizedView.split(warning).length - 1 === 1,
    `Expected one concise response metadata warning. Pane:\n${view}`,
  );
  assert(
    !/Extension .*? error:/i.test(normalizedView),
    `Response write failure leaked a generic extension error. Pane:\n${view}`,
  );
  await harness.finish();

  console.log(
    "PASS provider-payload-debug response-write E2E: metadata failure warns without breaking streaming",
  );
} finally {
  server.stop(true);
  await cleanupRun(runDirectory);
}
