import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanupRun, makeRunDirectory, PiTuiHarness } from "./harness.ts";

const root = resolve(import.meta.dir, "../../..");
const runDirectory = makeRunDirectory(root);

function stripAnsi(text: string): string {
  return text.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, "");
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
    name: "themed-dialog-borders-baseline",
    root,
    runDirectory,
    extensions: ["extensions/test/e2e/fixture/ui-probe.ts"],
  });
  await baseline.waitFor("UI PROBE READY");
  await baseline.submit("/e2e-dialog");
  await baseline.waitFor("E2E BORDER PROBE");
  const baselinePane = await baseline.capture(true);
  await baseline.sendKeys("Escape");
  await baseline.waitFor("E2E BORDER RESULT cancelled");
  await finish(baseline);

  const capturePath = `${runDirectory}/themed-border-captures.json`;
  const harness = await PiTuiHarness.start({
    name: "themed-dialog-borders",
    root,
    runDirectory,
    extensions: [
      "extensions/themed-dialog-borders.ts",
      "extensions/test/e2e/fixture/ui-probe.ts",
      "extensions/test/e2e/fixture/themed-dialog-borders-probe.ts",
    ],
    environment: { PI_E2E_THEMED_BORDER_CAPTURE: capturePath },
  });
  await harness.waitFor("UI PROBE READY");
  await harness.submit("/e2e-dialog");
  await harness.waitFor("E2E BORDER PROBE");
  const patchedPane = await harness.capture(true);

  const borderLines = (pane: string) =>
    pane
      .split("\n")
      .filter((line) => stripAnsi(line).includes("──────────"))
      .map((line) => line.match(/\x1b\[[0-9;]*m/)?.[0] ?? "plain");
  const before = borderLines(baselinePane);
  const after = borderLines(patchedPane);
  harness.assert(
    before.length > 0 && after.length > 0,
    "Dialog border ANSI was not captured",
  );
  harness.assert(
    JSON.stringify(before) !== JSON.stringify(after),
    "Themed dialog border did not change from Pi's default border color",
  );

  const assertExactCaptures = (expectedCount: number) => {
    const captures = JSON.parse(readFileSync(capturePath, "utf8")) as Array<{
      expectedAccent: string;
      defaultBorder: string[];
      customBorder: string[];
      expectedCustom: string[];
    }>;
    harness.assert(captures.length === expectedCount, `Expected ${expectedCount} border captures, got ${captures.length}`);
    for (const capture of captures) {
      harness.assert(
        JSON.stringify(capture.defaultBorder) === JSON.stringify([capture.expectedAccent]),
        "Default DynamicBorder did not use the exact active accent ANSI",
      );
      harness.assert(
        JSON.stringify(capture.customBorder) === JSON.stringify(capture.expectedCustom),
        "Custom DynamicBorder color was overridden",
      );
    }
  };
  harness.assert(existsSync(capturePath), "Border probe capture was not written");
  assertExactCaptures(1);

  await harness.sendKeys("Escape");
  await harness.waitFor("E2E BORDER RESULT cancelled");
  await harness.submit("/new");
  await harness.waitUntil("new-session border refresh", () => {
    if (!existsSync(capturePath)) return false;
    return (JSON.parse(readFileSync(capturePath, "utf8")) as unknown[]).length === 2;
  });
  assertExactCaptures(2);
  await harness.submit("/reload");
  await harness.waitUntil("reload border refresh", () => {
    return (JSON.parse(readFileSync(capturePath, "utf8")) as unknown[]).length === 3;
  });
  assertExactCaptures(3);
  await finish(harness);
  console.log("PASS themed-dialog-borders");
} finally {
  await cleanupRun(runDirectory);
}
