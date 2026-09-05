import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  cleanupRun,
  makeRunDirectory,
  PiTuiHarness,
} from "../../../../extensions/test/e2e/harness.ts";
import {
  assistantTexts,
  functionArguments,
  imageUrl,
  shapeInput,
  text,
  toolJson,
  toolText,
} from "./fixture/payload-mutator.ts";

const root = resolve(import.meta.dir, "../../../..");
const runDirectory = makeRunDirectory(root);

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

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function providerResponse(): Response {
  const chunks = [
    {
      id: "summary-shapes",
      object: "chat.completion.chunk",
      created: 1_767_225_600,
      model: "fake",
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: "SUMMARY_SHAPES_PROVIDER_REACHED" },
          finish_reason: null,
        },
      ],
    },
    {
      id: "summary-shapes",
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
    return providerResponse();
  },
});

try {
  const providerUrl = new URL("/v1", server.url).toString().replace(/\/$/, "");
  const harness = await PiTuiHarness.start({
    name: "payload-summary-shapes",
    root,
    runDirectory,
    extensions: [
      "packages/provider-payload-debug/test/e2e/provider.ts",
      "packages/provider-payload-debug/test/e2e/fixture/payload-mutator.ts",
      "packages/provider-payload-debug",
    ],
    model: "provider-payload-debug-e2e/fake",
    cliArguments: ["--provider-payload-debug"],
    environment: { PROVIDER_PAYLOAD_DEBUG_E2E_URL: providerUrl },
    settings: { quietStartup: false, theme: "dark" },
  });

  await harness.submit("capture the provider payload shape");
  await harness.waitFor("SUMMARY_SHAPES_PROVIDER_REACHED", 8_000);

  const debugDir = join(
    runDirectory,
    "payload-summary-shapes-home",
    ".pi",
    "agent",
    "debug",
    "provider-payloads",
  );
  await harness.waitUntil(
    "one payload shape summary",
    () => filesNamed(debugDir, "summary.json").length === 1,
  );
  const summary = JSON.parse(
    readFileSync(filesNamed(debugDir, "summary.json")[0]!, "utf8"),
  );
  const openAI = summary.openAIResponsesInput;
  assert(openAI.itemCount === 9, "OpenAI Responses item count is wrong.");
  assert(
    openAI.itemTotals["input:primitive"]?.count === 1,
    "Primitive input count is wrong.",
  );
  assert(
    openAI.itemTotals["role:developer"]?.count === 1,
    "Developer input count is wrong.",
  );
  assert(openAI.itemTotals.unknown?.count === 1, "Unknown input count is wrong.");
  assert(openAI.itemTotals.user_message?.count === 1, "User item count is wrong.");
  assert(
    openAI.itemTotals.function_call_output?.count === 2,
    "Tool output item count is wrong.",
  );
  assert(openAI.itemTotals.message?.count === 1, "Assistant message count is wrong.");
  assert(openAI.itemTotals.function_call?.count === 1, "Function call count is wrong.");
  assert(openAI.itemTotals.reasoning?.count === 1, "Reasoning count is wrong.");
  assert(
    openAI.payloadFields.user_input_text_chars?.bytes === Buffer.byteLength(text),
    "Unicode user input byte count is wrong.",
  );
  assert(
    openAI.payloadFields.user_image_url_chars?.bytes === Buffer.byteLength(imageUrl),
    "Image URL byte count is wrong.",
  );
  assert(
    openAI.payloadFields.tool_output_text_chars?.bytes === Buffer.byteLength(toolText),
    "Text tool output byte count is wrong.",
  );
  assert(
    openAI.payloadFields.tool_output_json_chars?.bytes === jsonBytes(toolJson),
    "JSON tool output byte count is wrong.",
  );
  assert(
    openAI.payloadFields.assistant_output_text_chars?.count === 2 &&
      openAI.payloadFields.assistant_output_text_chars?.bytes ===
        assistantTexts.reduce(
          (total, value) => total + Buffer.byteLength(value),
          0,
        ),
    "Assistant multi-part output totals are wrong.",
  );
  assert(
    openAI.payloadFields.assistant_function_arguments_chars?.bytes ===
      Buffer.byteLength(functionArguments),
    "Unicode function argument byte count is wrong.",
  );
  assert(
    openAI.payloadFields.assistant_reasoning_item_json_chars?.bytes ===
      jsonBytes(shapeInput[8]),
    "Reasoning item byte count is wrong.",
  );
  assert(
    summary.messagesArrayTotals["role:system"]?.count === 1,
    "System message total is wrong.",
  );
  assert(
    summary.messagesArrayTotals["role:user"]?.count === 1,
    "User message total is wrong.",
  );
  assert(
    summary.messagesArrayTotals["role:assistant"]?.count === 1,
    "Assistant message total is wrong.",
  );
  assert(
    summary.messagesArrayTotals["type:tool"]?.count === 1,
    "Typed tool message total is wrong.",
  );
  assert(
    summary.messagesArrayTotals["message:primitive"]?.count === 1,
    "Primitive message total is wrong.",
  );
  assert(summary.imagePayloads.length === 2, "Nested image payload discovery is wrong.");
  assert(
    summary.imagePayloads
      .map((image: { mimeType?: string }) => image.mimeType)
      .sort()
      .join(",") === "image/png,image/webp",
    "Image MIME summaries are wrong.",
  );

  await harness.finish();
  console.log(
    "PASS provider-payload-debug summary-shapes real-PTY E2E: final request event preserves shape and byte totals",
  );
} finally {
  server.stop(true);
  await cleanupRun(runDirectory);
}
