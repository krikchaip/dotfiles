import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanupRun, makeRunDirectory, PiTuiHarness } from "./harness.ts";

const root = resolve(import.meta.dir, "../../..");
const runDirectory = makeRunDirectory(root);
const capturePath = `${runDirectory}/provider-context.json`;
const ESC = "\x1b";

function collectStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, output);
  }
  return output;
}

const harness = await PiTuiHarness.start({
  name: "safe-terminal-output",
  root,
  runDirectory,
  extensions: [
    "extensions/test/e2e/fixture/safe-terminal-provider.ts",
    "extensions/safe-terminal-output.ts",
  ],
  model: "safe-terminal-e2e/fake",
  environment: {
    PI_E2E_SAFE_TERMINAL_CAPTURE: capturePath,
    PI_E2E_SAFE_TERMINAL_IMAGE: "1",
  },
});

try {
  await harness.submit("Run the unsafe_terminal_output tool.");
  await harness.waitFor("STREAM_ERASE_MARK");
  await harness.waitFor("SAFE_TERMINAL_DONE");
  await harness.sendKeys("C-o");
  await harness.waitFor("ERASE_MARK");
  await harness.waitUntil("sanitized provider context", () => existsSync(capturePath));

  const strings = collectStrings(JSON.parse(readFileSync(capturePath, "utf8")));
  const toolText = strings.find((text) => text.includes("SAFE_HEAD"));
  if (!toolText) throw new Error("Provider context did not contain the tool result");
  harness.assert(
    toolText.includes("SAFE_HEAD   COL2CRBSERASE_MARKTITLE_MARK"),
    `Control removal or tab expansion changed: ${JSON.stringify(toolText)}`,
  );
  for (const visible of ["ST_TITLE_MARK", "DCS_MARK", "SOS_MARK", "PM_MARK", "APC_MARK"]) {
    harness.assert(toolText.includes(visible), `Visible boundary marker was removed: ${visible}`);
  }
  harness.assert(toolText.includes("BG_ATTACK"), "Background text was removed");
  harness.assert(toolText.includes(`${ESC}[31mFG_SAFE${ESC}[0m`), "Safe SGR was removed");
  harness.assert(
    toolText.includes(`${ESC}]8;;https://example.test\x07LINK${ESC}]8;;\x07`),
    "Safe OSC 8 hyperlink was removed",
  );
  harness.assert(!toolText.includes(`${ESC}[41m`), "Tool background SGR reached the model");
  harness.assert(!toolText.includes(`${ESC}[48;2;1;2;3m`), "Extended background SGR reached the model");
  harness.assert(
    toolText.includes(`${ESC}[38;2;4;5;6mRGB_FG_SAFE${ESC}[0m`),
    "Extended foreground SGR was removed",
  );
  for (const unsafePayload of [
    "DCS_ATTACK",
    "TITLE_ATTACK",
    "ST_TITLE_ATTACK",
    "SOS_ATTACK",
    "PM_ATTACK",
    "APC_ATTACK",
  ]) {
    harness.assert(!toolText.includes(unsafePayload), `${unsafePayload} reached the model`);
  }

  await harness.sendLiteral("/reload");
  await harness.sendKeys("Enter");
  await harness.waitFor("Reloaded keybindings", 8_000);
  await harness.submit("Run the unsafe_terminal_output tool after reload.");
  await harness.waitUntil("second sanitized tool result", async () => {
    const pane = await harness.capture();
    return (pane.match(/SAFE_TERMINAL_DONE/g) ?? []).length === 2;
  });
  await harness.finish();
  const terminalBytes = readFileSync(harness.logPath, "utf8");
  for (const unsafe of [
    `${ESC}[2JERASE_MARK`,
    `${ESC}]0;TITLE_ATTACK`,
    `${ESC}]2;ST_TITLE_ATTACK`,
    `${ESC}P1;2|DCS_ATTACK`,
    `${ESC}XSOS_ATTACK`,
    `${ESC}^PM_ATTACK`,
    `${ESC}_APC_ATTACK`,
    `${ESC}[41mBG_ATTACK`,
    `${ESC}[48;2;1;2;3mRGB_BG_ATTACK`,
    `\x9b2JC1_MARK`,
    `${ESC}[2JSTREAM_ERASE_MARK`,
    `${ESC}]0;STREAM_TITLE_ATTACK`,
  ]) {
    harness.assert(
      !terminalBytes.includes(unsafe),
      `Unsafe terminal bytes were replayed: ${JSON.stringify(unsafe)}`,
    );
  }
  harness.assert(
    terminalBytes.includes(`${ESC}_G`) && terminalBytes.includes("i=4242"),
    "Intentional Kitty image protocol was removed from terminal output",
  );

  console.log("PASS safe-terminal-output protocol-stream-image-reload");
} finally {
  await harness.abort().catch(() => undefined);
  await cleanupRun(runDirectory);
}
