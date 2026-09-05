import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  cleanupRun,
  makeRunDirectory,
  PiTuiHarness,
} from "../../../../extensions/test/e2e/harness.ts";

const root = resolve(import.meta.dir, "../../../..");
const runDirectory = makeRunDirectory(root);
let requestCount = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function providerResponse(): Response {
  const chunks = [
    {
      id: "write-failure-response",
      object: "chat.completion.chunk",
      created: 1_767_225_600,
      model: "fake",
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: "WRITE_FAILURE_PROVIDER_REACHED" },
          finish_reason: null,
        },
      ],
    },
    {
      id: "write-failure-response",
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
    name: "payload-write-failure",
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

  const debugParent = join(
    runDirectory,
    "payload-write-failure-home",
    ".pi",
    "agent",
    "debug",
  );
  mkdirSync(debugParent, { recursive: true });
  const blockedPath = join(debugParent, "provider-payloads");
  rmSync(blockedPath, { recursive: true, force: true });
  writeFileSync(blockedPath, "deterministic directory collision\n");

  await harness.submit("request must survive capture write failure");
  await harness.waitFor("WRITE_FAILURE_PROVIDER_REACHED", 8_000);
  assert(requestCount === 1, `Expected provider request despite capture failure, got ${requestCount}.`);
  const view = await harness.capture();
  const normalizedView = view.replace(/\s+/g, " ");
  const warning =
    "provider-payload-debug: capture failed (ENOTDIR); provider request will continue";
  assert(
    normalizedView.split(warning).length - 1 === 1,
    `Expected one concise package warning. Pane:\n${view}`,
  );
  assert(
    !/Extension .*? error:/i.test(normalizedView),
    `Capture failure leaked a generic extension error. Pane:\n${view}`,
  );
  await harness.finish();

  console.log(
    "PASS provider-payload-debug write-failure E2E: capture I/O failure warns without blocking provider request",
  );
} finally {
  server.stop(true);
  await cleanupRun(runDirectory);
}
