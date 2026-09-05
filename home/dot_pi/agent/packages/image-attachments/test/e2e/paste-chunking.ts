import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  cleanupRun,
  makeRunDirectory,
  PiTuiHarness,
} from "../../../../extensions/test/e2e/harness.ts";
import { writeImageFixtures } from "./fixtures.ts";

const root = resolve(import.meta.dir, "../../../..");
const runDirectory = makeRunDirectory(root);
const editorStatePath = join(runDirectory, "editor-state.json");

function stateText(): string | undefined {
  if (!existsSync(editorStatePath)) return undefined;
  return JSON.parse(readFileSync(editorStatePath, "utf8")).text;
}

try {
  const pngPath = writeImageFixtures(runDirectory, "paste").get("image/png")!;
  const uppercasePath = join(runDirectory, "PASTE.PNG");
  copyFileSync(pngPath, uppercasePath);
  const clipboardPath = join(
    runDirectory,
    "pi-clipboard-00000000-0000-4000-8000-000000000007.png",
  );
  copyFileSync(pngPath, clipboardPath);
  const lookalikePath = join(runDirectory, "pi-clipboard-not-a-uuid.png");
  copyFileSync(pngPath, lookalikePath);
  const clipboardValues = [
    `before (\"${clipboardPath}\"), after`,
    lookalikePath,
    `${clipboardPath}suffix`,
    `${clipboardPath} ${clipboardPath}`,
  ];

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("Not used", { status: 500 }),
  });
  try {
    const providerUrl = new URL("/v1", server.url).toString().replace(/\/$/, "");
    const harness = await PiTuiHarness.start({
      name: "image-paste-chunking",
      root,
      runDirectory,
      extensions: [
        "packages/image-attachments/test/e2e/provider.ts",
        "packages/image-attachments/test/e2e/clipboard-sequence.ts",
        "packages/image-attachments",
        "packages/image-attachments/test/e2e/probe.ts",
      ],
      model: "image-attachments-e2e/vision",
      environment: {
        IMAGE_ATTACHMENTS_E2E_URL: providerUrl,
        IMAGE_ATTACHMENTS_EDITOR_STATE: editorStatePath,
        IMAGE_ATTACHMENTS_CLIPBOARD_VALUES: JSON.stringify(clipboardValues),
      },
      settings: { quietStartup: false, theme: "dark" },
      width: 78,
    });
    await harness.waitFor("IMAGE_CLIPBOARD_SEQUENCE_READY");

    const split = Math.floor(pngPath.length / 2);
    await harness.sendLiteral(`prefix \x1b[200~${pngPath.slice(0, split)}`);
    await harness.sendLiteral(pngPath.slice(split));
    await harness.sendLiteral("\x1b[201~ suffix");
    await harness.waitUntil(
      "split paste assembly",
      () => stateText() === "prefix [#image 1] suffix",
    );

    await harness.sendKeys("C-u");
    await harness.sendLiteral(`\x1b[200~  ${pngPath}  \x1b[201~`);
    await harness.waitUntil("trimmed single path", () => stateText() === "[#image 1]");

    await harness.sendKeys("C-u");
    const multiple = `${pngPath} ${pngPath}`;
    await harness.sendLiteral(`\x1b[200~${multiple}\x1b[201~`);
    await harness.waitUntil("multiple paths pass through", () => stateText() === multiple);

    await harness.sendKeys("C-u");
    await harness.sendLiteral("\x1b[200~relative.png\x1b[201~");
    await harness.waitUntil("relative path pass through", () => stateText() === "relative.png");

    await harness.sendKeys("C-u");
    await harness.sendLiteral(`\x1b[200~${uppercasePath}\x1b[201~`);
    await harness.waitUntil("case-insensitive extension", () => stateText() === "[#image 1]");

    await harness.sendKeys("C-u");
    await harness.sendLiteral("\x16");
    await harness.waitUntil(
      "quoted clipboard path conversion",
      () => stateText() === 'before ("[#image 1]"), after',
    );

    await harness.sendKeys("C-u");
    await harness.sendLiteral("\x16");
    await harness.waitUntil("clipboard UUID grammar rejection", () => stateText() === lookalikePath);

    await harness.sendKeys("C-u");
    await harness.sendLiteral("\x16");
    await harness.waitUntil(
      "clipboard trailing-boundary rejection",
      () => stateText() === `${clipboardPath}suffix`,
    );

    await harness.sendKeys("C-u");
    await harness.sendLiteral("\x16");
    await harness.waitUntil(
      "multiple clipboard path conversion",
      () => stateText() === "[#image 1] [#image 2]",
    );

    await harness.finish();
    console.log(
      "PASS image-attachments paste E2E: split chunks, single-path grammar, case handling, UUID boundaries, and multiple clipboard paths",
    );
  } finally {
    server.stop(true);
  }
} finally {
  await cleanupRun(runDirectory);
}
