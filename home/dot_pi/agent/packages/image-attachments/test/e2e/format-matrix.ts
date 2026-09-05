import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  cleanupRun,
  makeRunDirectory,
  PiTuiHarness,
} from "../../../../extensions/test/e2e/harness.ts";
import { imageFixtures, writeImageFixtures } from "./fixtures.ts";

const root = resolve(import.meta.dir, "../../../..");
const runDirectory = makeRunDirectory(root);
const requests: unknown[] = [];

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

function providerResponse(): Response {
  const chunks = [
    {
      id: "format-matrix",
      object: "chat.completion.chunk",
      created: 1_767_225_600,
      model: "vision",
      choices: [
        { index: 0, delta: { role: "assistant", content: "IMAGE_FORMAT_MATRIX_RESPONSE" }, finish_reason: null },
      ],
    },
    {
      id: "format-matrix",
      object: "chat.completion.chunk",
      created: 1_767_225_600,
      model: "vision",
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
    requests.push(await request.json());
    return providerResponse();
  },
});

const providerUrl = new URL("/v1", server.url).toString().replace(/\/$/, "");
const paths = writeImageFixtures(runDirectory, "matrix");

function editorText(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")).text;
}

async function providerAndFallbackBranch(): Promise<void> {
  const harness = await PiTuiHarness.start({
    name: "image-format-provider",
    root,
    runDirectory,
    extensions: [
      "packages/image-attachments/test/e2e/provider.ts",
      "packages/image-attachments",
    ],
    model: "image-attachments-e2e/vision",
    environment: { IMAGE_ATTACHMENTS_E2E_URL: providerUrl, TERM_PROGRAM: "" },
    settings: { quietStartup: false, theme: "dark" },
    width: 84,
  });

  for (let index = 0; index < imageFixtures.length; index += 1) {
    const path = paths.get(imageFixtures[index]!.mimeType)!;
    await harness.sendLiteral(`\x1b[200~${path}\x1b[201~`);
    await harness.waitFor(`[#image ${index + 1}]`);
  }
  let pane = await harness.waitFor("4 images attached");
  assert(pane.includes("[Image:"), "Non-Kitty terminal did not render the image text fallback.");
  await harness.sendLiteral(" inspect every image format");
  await harness.sendKeys("Enter");
  await harness.waitFor("IMAGE_FORMAT_MATRIX_RESPONSE");
  await harness.waitUntil("format provider request", () => requests.length === 1);

  const actual = dataImages(requests[0]);
  const expected = imageFixtures.map(
    (fixture) => `data:${fixture.mimeType};base64,${fixture.base64}`,
  );
  assert(actual.length === expected.length, `Expected four provider images, got ${actual.length}.`);
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `Provider MIME/byte matrix changed:\n${JSON.stringify(actual, null, 2)}`,
  );
  await harness.finish();
  console.log("PASS image-attachments format matrix provider/fallback branch");
}

async function kittyConversionBranch(extension?: string): Promise<void> {
  const failures: string[] = [];
  const selectedFixtures = extension
    ? imageFixtures.filter((fixture) => fixture.extension === extension)
    : imageFixtures;
  if (selectedFixtures.length === 0) throw new Error(`Unknown image format: ${extension}.`);

  for (const fixture of selectedFixtures) {
    const kittyEditorState = join(runDirectory, `kitty-${fixture.extension}-editor-state.json`);
    const harness = await PiTuiHarness.start({
      name: `image-format-kitty-${fixture.extension}`,
      root,
      runDirectory,
      extensions: [
        "packages/image-attachments/test/e2e/provider.ts",
        "extensions/tmux-kitty-images.ts",
        "packages/image-attachments",
        "packages/image-attachments/test/e2e/probe.ts",
      ],
      model: "image-attachments-e2e/vision",
      environment: {
        IMAGE_ATTACHMENTS_E2E_URL: providerUrl,
        TERM: "tmux-256color",
        TERM_PROGRAM: "kitty",
        KITTY_WINDOW_ID: "1",
        COLORTERM: "truecolor",
        IMAGE_ATTACHMENTS_EDITOR_STATE: kittyEditorState,
      },
      settings: { quietStartup: false, theme: "dark" },
      width: 84,
    });

    try {
      const path = paths.get(fixture.mimeType)!;
      await harness.sendLiteral(`\x1b[200~${path}\x1b[201~`);
      await harness.waitUntil(
        `Kitty ${fixture.mimeType} placeholder`,
        () => editorText(kittyEditorState) === "[#image 1]",
      );
      await harness.waitUntil(`Kitty ${fixture.mimeType} conversion`, () => {
        if (!existsSync(harness.logPath)) return false;
        return readFileSync(harness.logPath, "utf8").includes("a=t");
      }, 15_000);

      const log = readFileSync(harness.logPath, "utf8");
      assert(log.includes("\x1bPtmux;\x1b\x1b_G"), `${fixture.mimeType} Kitty graphics were not tmux wrapped.`);
      assert(log.includes("U=1"), `${fixture.mimeType} Kitty graphics did not use Unicode placement.`);
      assert(!log.includes("[Image:"), `${fixture.mimeType} Kitty conversion fell back to text rendering.`);
      if (fixture.mimeType !== "image/png") {
        assert(!log.includes(fixture.base64), `${fixture.mimeType} bytes were sent without PNG conversion.`);
      }
      assert(log.includes("iVBOR"), `${fixture.mimeType} Kitty payload has no PNG signature.`);
      await harness.finish();
      console.log(`PASS image-attachments Kitty conversion ${fixture.mimeType}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${fixture.mimeType}: ${message}`);
      console.error(`RED image-attachments Kitty conversion ${fixture.mimeType}: ${message}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Kitty format failures:\n${failures.join("\n")}`);
  }
  console.log("PASS image-attachments format matrix Kitty conversion branch");
}

const branchArgument = process.argv.find((arg) => arg.startsWith("--branch="));
const branch = branchArgument?.slice("--branch=".length);
const formatArgument = process.argv.find((arg) => arg.startsWith("--format="));
const format = formatArgument?.slice("--format=".length);
if (branch && branch !== "provider" && branch !== "kitty") {
  throw new Error(`Unknown format branch: ${branch}.`);
}

try {
  if (!branch || branch === "provider") await providerAndFallbackBranch();
  if (!branch || branch === "kitty") await kittyConversionBranch(format);
  console.log(
    `PASS image-attachments format E2E: ${branch ?? "all"}${format ? `/${format}` : ""}`,
  );
} finally {
  server.stop(true);
  await cleanupRun(runDirectory);
}
