import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function countImages(value: unknown): number {
  let count = 0;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if ((node as { type?: string }).type === "image") count += 1;
    if (Array.isArray(node)) node.forEach(visit);
    else Object.values(node).forEach(visit);
  };
  visit(value);
  return count;
}

try {
  const imagePath = join(runDirectory, "tool-loop.png");
  const capturePath = join(runDirectory, "contexts.json");
  mkdirSync(runDirectory, { recursive: true });
  writeFileSync(imagePath, Buffer.from(pngBase64, "base64"));

  const harness = await PiTuiHarness.start({
    name: "image-tool-loop",
    root,
    runDirectory,
    extensions: [
      "packages/image-attachments/test/e2e/tool-loop-provider.ts",
      "packages/image-attachments",
    ],
    model: "image-tool-loop-e2e/vision",
    environment: { IMAGE_TOOL_LOOP_CAPTURE: capturePath },
    settings: { quietStartup: false, theme: "dark" },
  });

  await harness.sendLiteral(`\x1b[200~${imagePath}\x1b[201~`);
  await harness.waitFor("[#image 1]");
  await harness.sendLiteral(" inspect through a tool call");
  await harness.sendKeys("Enter");
  await harness.waitFor("IMAGE_TOOL_LOOP_DONE");
  await harness.waitUntil("two provider contexts", () => {
    if (!existsSync(capturePath)) return false;
    return JSON.parse(readFileSync(capturePath, "utf8")).length === 2;
  });

  const contexts = JSON.parse(readFileSync(capturePath, "utf8"));
  assert(countImages(contexts[0]) === 1, "Initial provider call did not contain one image.");
  assert(countImages(contexts[1]) === 1, "Tool-loop provider call did not retain one active image.");
  const secondMessages = contexts[1].messages;
  assert(Array.isArray(secondMessages), "Second provider context has no message array.");
  const toolIndex = secondMessages.findIndex((message: { role?: string }) => message.role === "toolResult");
  const trailingImageIndex = secondMessages.findIndex(
    (message: { role?: string; content?: unknown[] }, index: number) =>
      index > toolIndex &&
      message.role === "user" &&
      Array.isArray(message.content) &&
      message.content.some(
        (block) =>
          !!block &&
          typeof block === "object" &&
          (block as { type?: string }).type === "image",
      ),
  );
  assert(toolIndex >= 0, "Second provider context omitted the tool result.");
  assert(trailingImageIndex > toolIndex, "Active image was not moved after the tool result.");

  await harness.finish();
  console.log(
    "PASS image-attachments tool-loop E2E: active image bytes remain once after tool results",
  );
} finally {
  await cleanupRun(runDirectory);
}
