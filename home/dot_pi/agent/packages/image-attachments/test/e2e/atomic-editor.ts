import { existsSync, readFileSync } from "node:fs";
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
const commandCapturePath = join(runDirectory, "commands.jsonl");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function editorState(): { text: string; cursorLine: number; cursorCol: number } | undefined {
  if (!existsSync(editorStatePath)) return undefined;
  return JSON.parse(readFileSync(editorStatePath, "utf8"));
}

try {
  const paths = writeImageFixtures(runDirectory, "atomic");
  const firstPath = paths.get("image/png")!;
  const secondPath = join(runDirectory, "atomic-second.png");
  await Bun.write(secondPath, Bun.file(firstPath));

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("Not used", { status: 500 }),
  });

  try {
    const providerUrl = new URL("/v1", server.url).toString().replace(/\/$/, "");
    const harness = await PiTuiHarness.start({
      name: "image-atomic-editor",
      root,
      runDirectory,
      extensions: [
        "packages/image-attachments/test/e2e/provider.ts",
        "packages/image-attachments",
        "packages/image-attachments/test/e2e/probe.ts",
      ],
      model: "image-attachments-e2e/vision",
      environment: {
        IMAGE_ATTACHMENTS_E2E_URL: providerUrl,
        IMAGE_ATTACHMENTS_EDITOR_STATE: editorStatePath,
        IMAGE_ATTACHMENTS_COMMAND_CAPTURE: commandCapturePath,
      },
      settings: { quietStartup: false, theme: "dark" },
      width: 76,
    });
    await harness.waitFor("IMAGE_ATTACHMENTS_E2E_READY");

    await harness.sendLiteral(`\x1b[200~${firstPath}\x1b[201~`);
    await harness.sendLiteral(" middle ");
    await harness.sendLiteral(`\x1b[200~${secondPath}\x1b[201~`);
    const original = "[#image 1] middle [#image 2]";
    await harness.waitUntil("two draft placeholders", () => editorState()?.text === original);
    assert(editorState()?.cursorCol === original.length, "Cursor did not finish after the second placeholder.");

    await harness.sendKeys("M-b");
    await harness.waitUntil("atomic word-left movement", () => editorState()?.cursorCol === 18);
    await harness.sendKeys("M-f");
    await harness.waitUntil("atomic word-right movement", () => editorState()?.cursorCol === original.length);

    await harness.sendKeys("C-w");
    await harness.waitUntil(
      "atomic backward deletion",
      () => editorState()?.text === "[#image 1] middle ",
    );
    await harness.sendLiteral("\x1f");
    await harness.waitUntil("undo backward deletion", () => editorState()?.text === original);

    await harness.sendKeys("C-a", "M-d");
    await harness.waitUntil(
      "atomic forward deletion and renumbering",
      () => editorState()?.text === " middle [#image 1]",
    );
    await harness.sendLiteral("\x1f");
    await harness.waitUntil("undo forward deletion", () => editorState()?.text === original);

    await harness.sendKeys("C-a", "C-k");
    await harness.waitUntil("kill to line end", () => editorState()?.text === "");
    await harness.sendLiteral("\x1f");
    await harness.waitUntil("undo line-end kill", () => editorState()?.text === original);

    await harness.sendKeys("C-e", "C-u");
    await harness.waitUntil("kill to line start", () => editorState()?.text === "");
    await harness.sendLiteral("\x1f");
    await harness.waitUntil("undo line-start kill", () => editorState()?.text === original);

    await harness.sendKeys("C-a");
    await harness.sendLiteral("/image-e2e-capture ");
    await harness.sendKeys("Enter");
    await harness.waitFor("IMAGE_E2E_COMMAND:");
    await harness.waitUntil("command capture", () => existsSync(commandCapturePath));
    const capturedArgs = JSON.parse(readFileSync(commandCapturePath, "utf8").trim());
    assert(capturedArgs === `${firstPath} middle ${secondPath}`, `Command path expansion changed: ${capturedArgs}`);

    await harness.sendKeys("Up");
    const historyText = `/image-e2e-capture ${original}`;
    await harness.waitUntil("draft history restoration", () => editorState()?.text === historyText);
    const historyPane = await harness.waitFor("2 images attached");
    assert(historyPane.includes("[#image 1]") && historyPane.includes("[#image 2]"), "History preview lost an image.");
    await harness.sendKeys("Down");
    await harness.waitUntil("history draft exit", () => editorState()?.text === "");

    await harness.finish();
    console.log(
      "PASS image-attachments atomic editor E2E: movement, two-way deletion, line kills, undo, renumbering, and history restore",
    );
  } finally {
    server.stop(true);
  }
} finally {
  await cleanupRun(runDirectory);
}
