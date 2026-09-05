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

function editorLine(pane: string, text: string): string {
  return pane.split("\n").find((line) => stripAnsi(line).trim() === text) ?? "";
}

function lineContaining(pane: string, text: string): string {
  return pane.split("\n").find((line) => stripAnsi(line).includes(text)) ?? "";
}

function sgrCount(line: string): number {
  return (line.match(/\x1b\[/g) ?? []).length;
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
  const baseline = await PiTuiHarness.start({
    name: "slash-highlight-baseline",
    root,
    runDirectory,
    extensions: [
      "extensions/test/e2e/fixture/ui-probe.ts",
      "extensions/test/e2e/fixture/faux-provider.ts",
    ],
    skills: ["extensions/test/e2e/fixture/skills/alpha/SKILL.md"],
    model: "extension-e2e/fake",
    width: 44,
    environment: {
      PI_E2E_RESPONSES: JSON.stringify(["BASELINE HISTORY RESPONSE"]),
    },
  });
  await baseline.waitFor("UI PROBE READY");
  await baseline.sendLiteral("/e2e-c");
  await baseline.waitFor("/e2e-c");
  const baselinePane = await baseline.capture(true);
  await baseline.sendKeys("C-u");
  await baseline.sendLiteral("/not-registered");
  await baseline.waitFor("/not-registered");
  const baselineInvalidPane = await baseline.capture(true);
  await baseline.sendKeys("C-u");
  await baseline.submit("before /alpha after");
  await baseline.waitFor("BASELINE HISTORY RESPONSE");
  const baselineHistoryPane = await baseline.capture(true);
  await finish(baseline);

  const harness = await PiTuiHarness.start({
    name: "slash-highlight",
    root,
    runDirectory,
    extensions: [
      "extensions/test/e2e/fixture/ui-probe.ts",
      "extensions/test/e2e/fixture/faux-provider.ts",
      "extensions/slash-highlight.ts",
    ],
    skills: ["extensions/test/e2e/fixture/skills/alpha/SKILL.md"],
    model: "extension-e2e/fake",
    width: 44,
    environment: {
      PI_E2E_RESPONSES: JSON.stringify(["PATCHED HISTORY RESPONSE"]),
    },
  });
  await harness.waitFor("UI PROBE READY");
  await harness.sendLiteral("/e2e-c");
  await harness.waitFor("/e2e-c");
  const patchedPane = await harness.capture(true);

  const before = editorLine(baselinePane, "/e2e-c");
  const after = editorLine(patchedPane, "/e2e-c");
  harness.assert(
    before.length > 0 && after.length > 0,
    "Slash command editor line was not captured",
  );
  harness.assert(before !== after, "Slash command editor ANSI did not change");
  harness.assert(
    sgrCount(after) > sgrCount(before),
    "Slash command did not gain highlight ANSI",
  );

  await harness.sendKeys("C-u");
  await harness.sendLiteral("/not-registered");
  await harness.waitFor("/not-registered");
  const invalidBefore = editorLine(baselineInvalidPane, "/not-registered");
  const invalidAfter = editorLine(
    await harness.capture(true),
    "/not-registered",
  );
  harness.assert(
    invalidBefore.length > 0 && invalidAfter.length > 0,
    "Unknown slash command editor line was not captured",
  );
  harness.assert(
    sgrCount(invalidAfter) === sgrCount(invalidBefore),
    "Unknown slash command was highlighted as registered",
  );

  await harness.sendKeys("C-u");
  await harness.sendLiteral("/alpha argument");
  await harness.waitFor("/alpha argument");
  const skillLine = editorLine(await harness.capture(true), "/alpha argument");
  harness.assert(
    skillLine.length > 0,
    "Explicit skill editor line was not captured",
  );
  harness.assert(
    sgrCount(skillLine) > sgrCount(before),
    "Explicit skill command did not gain highlight ANSI",
  );

  await harness.sendKeys("C-u");
  await harness.submit("/reload");
  await harness.waitFor("Reloaded");
  await harness.sendLiteral("/e2e-c");
  await harness.waitFor("/e2e-c");
  const reloadedLine = editorLine(await harness.capture(true), "/e2e-c");
  harness.assert(
    sgrCount(reloadedLine) > sgrCount(before),
    "Command highlight was lost after resources_discover reload",
  );

  await harness.sendKeys("C-u");
  await harness.submit("/new");
  await Bun.sleep(400);
  await harness.sendLiteral("/e2e-c");
  await harness.waitFor("/e2e-c");
  const newSessionLine = editorLine(await harness.capture(true), "/e2e-c");
  harness.assert(
    sgrCount(newSessionLine) > sgrCount(before),
    "Command highlight was lost after session replacement",
  );

  await harness.sendKeys("C-u");
  await harness.submit("/reload");
  await harness.waitFor("Reloaded");
  await harness.sendLiteral("/alpha");
  await harness.waitFor("/alpha");
  const replacedReloadLine = editorLine(await harness.capture(true), "/alpha");
  harness.assert(
    sgrCount(replacedReloadLine) > sgrCount(before),
    "Skill highlight failed after session replacement and reload",
  );

  await harness.sendKeys("C-u");
  await harness.submit("before /alpha after");
  await harness.waitFor("PATCHED HISTORY RESPONSE");
  const baselineHistoryLine = lineContaining(
    baselineHistoryPane,
    "before /alpha after",
  );
  const patchedHistoryLine = lineContaining(
    await harness.capture(true),
    "before /alpha after",
  );
  harness.assert(
    baselineHistoryLine.length > 0 && patchedHistoryLine.length > 0,
    "Inline skill history line was not captured at narrow width",
  );
  harness.assert(
    sgrCount(patchedHistoryLine) > sgrCount(baselineHistoryLine),
    "Inline skill reference did not gain history highlight ANSI",
  );

  const log = stripAnsi(await Bun.file(harness.logPath).text());
  harness.assert(
    !/TypeError|Cannot read propert|Unhandled/i.test(log),
    "Slash highlight threw after reload or session replacement",
  );

  await finish(harness);
  console.log(
    "PASS slash-highlight: command, skill, narrow history, reload, and session replacement",
  );
} finally {
  await cleanupRun(runDirectory);
}
