import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanupRun, makeRunDirectory, PiTuiHarness } from "./harness.ts";

const root = resolve(import.meta.dir, "../../..");
const runDirectory = makeRunDirectory(root);

function stripAnsi(text: string): string {
  return text.replace(
    /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g,
    "",
  );
}

async function finish(harness: PiTuiHarness): Promise<void> {
  try {
    await harness.finish();
  } catch (error) {
    await harness.abort();
    throw error;
  }
}

try {
  const capturePath = `${runDirectory}/selection-copy.jsonl`;
  const harness = await PiTuiHarness.start({
    name: "clear-copied-selection",
    root,
    runDirectory,
    extensions: [
      "extensions/test/e2e/fixture/selection-probe.ts",
      "extensions/clear-copied-selection.ts",
    ],
    cliArguments: ["--tui-mode", "fullscreen"],
    environment: { PI_E2E_SELECTION_CAPTURE: capturePath },
  });
  await harness.waitFor("COPY SELECTION PROBE READY");

  const pane = await harness.capture();
  const paneLines = pane.replace(/\n$/, "").split("\n").slice(-32);
  const rowIndex = paneLines.findIndex((line) =>
    line.includes("COPY_SELECTION_TARGET_ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
  );
  harness.assert(rowIndex >= 0, "Selection target row was not visible");
  const startColumn = paneLines[rowIndex]!.indexOf("COPY_SELECTION_TARGET") + 1;
  const endColumn = startColumn + "COPY_SELECTION_TARGET".length - 1;
  const row = rowIndex + 1;

  await harness.sendLiteral(`\x1b[<0;${startColumn};${row}M`);
  await harness.sendLiteral(`\x1b[<32;${endColumn};${row}M`);
  await harness.waitUntil("visible fullscreen selection", async () => {
    const ansiPane = await harness.capture(true);
    const targetLine = ansiPane
      .replace(/\n$/, "")
      .split("\n")
      .slice(-32)
      .find((line) => stripAnsi(line).includes("COPY_SELECTION_TARGET"));
    return Boolean(targetLine?.includes("\x1b[7m"));
  });

  await harness.sendLiteral(`\x1b[<0;${endColumn};${row}m`);
  await harness.waitUntil("selection copy callback", () =>
    existsSync(capturePath),
  );
  await harness.waitUntil("cleared fullscreen selection", async () => {
    const ansiPane = await harness.capture(true);
    const targetLine = ansiPane
      .replace(/\n$/, "")
      .split("\n")
      .slice(-32)
      .find((line) => stripAnsi(line).includes("COPY_SELECTION_TARGET"));
    return Boolean(targetLine && !targetLine.includes("\x1b[7m"));
  });

  await harness.sendLiteral(`\x1b[<0;${endColumn};${row}M`);
  await harness.sendLiteral(`\x1b[<32;${startColumn};${row}M`);
  await harness.waitUntil("visible reverse selection", async () => {
    const ansiPane = await harness.capture(true);
    const targetLine = ansiPane
      .replace(/\n$/, "")
      .split("\n")
      .slice(-32)
      .find((line) => stripAnsi(line).includes("COPY_SELECTION_TARGET"));
    return Boolean(targetLine?.includes("\x1b[7m"));
  });
  await harness.sendLiteral(`\x1b[<0;${startColumn};${row}m`);
  await harness.waitUntil(
    "second selection copy callback",
    () => readFileSync(capturePath, "utf8").trim().split("\n").length >= 2,
  );
  await harness.waitUntil("cleared reverse selection", async () => {
    const ansiPane = await harness.capture(true);
    const targetLine = ansiPane
      .replace(/\n$/, "")
      .split("\n")
      .slice(-32)
      .find((line) => stripAnsi(line).includes("COPY_SELECTION_TARGET"));
    return Boolean(targetLine && !targetLine.includes("\x1b[7m"));
  });

  await harness.submit("/reload");
  await harness.waitFor("Reloaded");
  await harness.waitFor("COPY SELECTION PROBE READY");
  const reloadedLines = (await harness.capture())
    .replace(/\n$/, "")
    .split("\n")
    .slice(-32);
  const reloadedRowIndex = reloadedLines.findIndex((line) =>
    line.includes("COPY_SELECTION_TARGET_ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
  );
  harness.assert(
    reloadedRowIndex >= 0,
    "Reloaded selection target was not visible",
  );
  const reloadedStartColumn =
    reloadedLines[reloadedRowIndex]!.indexOf("COPY_SELECTION_TARGET") + 1;
  const reloadedEndColumn =
    reloadedStartColumn + "COPY_SELECTION_TARGET".length - 1;
  const reloadedRow = reloadedRowIndex + 1;
  await harness.sendLiteral(`\x1b[<0;${reloadedStartColumn};${reloadedRow}M`);
  await harness.sendLiteral(`\x1b[<32;${reloadedEndColumn};${reloadedRow}M`);
  await harness.sendLiteral(`\x1b[<0;${reloadedEndColumn};${reloadedRow}m`);
  await harness.waitUntil(
    "post-reload selection copy callback",
    () => readFileSync(capturePath, "utf8").trim().split("\n").length >= 3,
  );
  await harness.waitUntil("post-reload selection clear", async () => {
    const targetLine = (await harness.capture(true))
      .replace(/\n$/, "")
      .split("\n")
      .slice(-32)
      .find((line) => stripAnsi(line).includes("COPY_SELECTION_TARGET"));
    return Boolean(targetLine && !targetLine.includes("\x1b[7m"));
  });

  const copiedStates = readFileSync(capturePath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  harness.assert(
    copiedStates.length === 3,
    "Expected three isolated copy callbacks across reload",
  );
  for (const copiedState of copiedStates) {
    harness.assert(
      copiedState.anchor,
      "Copy callback did not receive a selection anchor",
    );
    harness.assert(
      copiedState.focus,
      "Copy callback did not receive a selection focus",
    );
    harness.assert(
      copiedState.granularity === "character",
      `Unexpected selection granularity: ${copiedState.granularity}`,
    );
  }
  await finish(harness);
  console.log(
    "PASS clear-copied-selection: forward, reverse, and post-reload drag clearing (native clipboard blocked)",
  );
} finally {
  await cleanupRun(runDirectory);
}
