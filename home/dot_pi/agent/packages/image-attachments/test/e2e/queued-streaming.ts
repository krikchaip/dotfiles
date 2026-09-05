import { resolve } from "node:path";
import {
  cleanupRun,
  makeRunDirectory,
  PiTuiHarness,
} from "../../../../extensions/test/e2e/harness.ts";
import { imageFixtures, writeImageFixtures } from "./fixtures.ts";

const root = resolve(import.meta.dir, "../../../..");
const runDirectory = makeRunDirectory(root);
const requests: unknown[] = [];
let sequence = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function dataImages(value: unknown): string[] {
  const found: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      if (node.startsWith("data:image/")) found.push(node);
      return;
    }
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) node.forEach(visit);
    else Object.values(node).forEach(visit);
  };
  visit(value);
  return found;
}

function streamResponse(index: number): Response {
  const encoder = new TextEncoder();
  const id = `queued-${index}`;
  const chunk = (content: string, finishReason: string | null) =>
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created: 1_767_225_600,
      model: "vision",
      choices: [
        {
          index: 0,
          delta: content ? { role: "assistant", content } : {},
          finish_reason: finishReason,
        },
      ],
    })}\n\n`;
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(
        encoder.encode(chunk(index === 1 ? "STREAMING_STARTED" : "QUEUED_IMAGE_RESPONSE", null)),
      );
      if (index === 1) await Bun.sleep(1_200);
      controller.enqueue(encoder.encode(chunk("", "stop")));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      return new Response("Not found", { status: 404 });
    }
    requests.push(await request.json());
    sequence += 1;
    return streamResponse(sequence);
  },
});

try {
  const imagePath = writeImageFixtures(runDirectory, "queued").get("image/png")!;
  const providerUrl = new URL("/v1", server.url).toString().replace(/\/$/, "");
  const harness = await PiTuiHarness.start({
    name: "image-queued-streaming",
    root,
    runDirectory,
    extensions: [
      "packages/image-attachments/test/e2e/provider.ts",
      "packages/image-attachments",
    ],
    model: "image-attachments-e2e/vision",
    environment: { IMAGE_ATTACHMENTS_E2E_URL: providerUrl },
    settings: { quietStartup: false, theme: "dark", steeringMode: "one-at-a-time" },
  });

  await harness.submit("hold the stream open");
  await harness.waitFor("STREAMING_STARTED");
  await harness.sendLiteral(`\x1b[200~${imagePath}\x1b[201~`);
  await harness.waitFor("[#image 1]");
  await harness.sendLiteral(" queued image context");
  await harness.sendKeys("Enter");
  await harness.waitFor("QUEUED_IMAGE_RESPONSE", 10_000);
  await harness.waitUntil("queued provider request", () => requests.length === 2);

  const images = dataImages(requests[1]);
  assert(images.length === 1, `Queued request contained ${images.length} images.`);
  assert(
    images[0] === `data:image/png;base64,${imageFixtures[0].base64}`,
    "Queued request changed the image bytes.",
  );
  assert(
    JSON.stringify(requests[1]).includes("queued image context"),
    "Queued request omitted its prompt text.",
  );

  await harness.finish();
  console.log(
    "PASS image-attachments queued-streaming E2E: a mid-stream queued placeholder keeps one exact image payload",
  );
} finally {
  server.stop(true);
  await cleanupRun(runDirectory);
}
