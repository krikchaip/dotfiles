import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  cleanupRun,
  makeRunDirectory,
  PiTuiHarness,
} from "../../../../extensions/test/e2e/harness.ts";

const root = resolve(import.meta.dir, "../../../..");
const runDirectory = makeRunDirectory(root);
const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
let requestCount = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function response(): Response {
  return new Response(
    `data: ${JSON.stringify({
      id: "unexpected",
      object: "chat.completion.chunk",
      created: 1_767_225_600,
      model: "text-only",
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: "UNEXPECTED_PROVIDER_REQUEST" },
          finish_reason: "stop",
        },
      ],
    })}\n\ndata: [DONE]\n\n`,
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
    return response();
  },
});

try {
  const validPath = join(runDirectory, "valid.png");
  const invalidPath = join(runDirectory, "invalid.png");
  const unsupportedPath = join(runDirectory, "unsupported.bmp");
  mkdirSync(runDirectory, { recursive: true });
  writeFileSync(validPath, Buffer.from(pngBase64, "base64"));
  writeFileSync(invalidPath, "not a png\n");
  writeFileSync(unsupportedPath, "BM-not-a-supported-image\n");

  const providerUrl = new URL("/v1", server.url).toString().replace(/\/$/, "");
  const harness = await PiTuiHarness.start({
    name: "image-input-boundaries",
    root,
    runDirectory,
    extensions: [
      "packages/image-attachments/test/e2e/provider.ts",
      "packages/image-attachments",
    ],
    model: "image-attachments-e2e/text-only",
    environment: { IMAGE_ATTACHMENTS_E2E_URL: providerUrl },
    settings: { quietStartup: false, theme: "dark" },
    width: 72,
  });

  await harness.sendLiteral(`\x1b[200~${unsupportedPath}\x1b[201~`);
  let view = await harness.waitFor("Image format .bmp is not supported");
  assert(view.includes("unsupported.bmp"), "Unsupported path was not preserved in the editor.");
  await harness.sendKeys("C-u");

  await harness.sendLiteral(`\x1b[200~${invalidPath}\x1b[201~`);
  view = await harness.waitFor("invalid.png");
  assert(!view.includes("[#image"), "Invalid PNG signature became an attachment.");
  await harness.sendKeys("C-u");

  await harness.sendLiteral(`\x1b[200~${validPath}\x1b[201~`);
  await harness.waitFor("[#image 1]");
  await harness.sendKeys("C-w");
  await harness.waitUntil("atomic placeholder deletion", async () => {
    const pane = await harness.capture();
    return !pane.includes("[#image 1]") && !pane.includes("1 image attached");
  });

  await harness.sendLiteral(`\x1b[200~${validPath}\x1b[201~`);
  await harness.waitFor("[#image 1]");
  await harness.sendLiteral(" must remain in editor");
  await harness.sendKeys("Enter");
  view = await harness.waitFor("does not support image input");
  assert(view.includes("[#image 1] must remain in editor"), "Blocked submit lost editor text.");
  assert(requestCount === 0, "Text-only model received a blocked image request.");

  await harness.sendKeys("C-u");
  await harness.sendLiteral("/new");
  await harness.sendKeys("Escape", "Enter");
  await harness.waitFor("New session started");
  await harness.sendLiteral(`\x1b[200~${validPath}\x1b[201~`);
  await harness.waitFor("[#image 1]");

  await harness.finish();
  console.log(
    "PASS image-attachments input E2E: unsupported and invalid paste, atomic delete, text-only model guard, editor preservation, and session reset",
  );
} finally {
  server.stop(true);
  await cleanupRun(runDirectory);
}
