import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanupRun, makeRunDirectory, PiTuiHarness } from "./harness.ts";

const root = resolve(import.meta.dir, "../../..");
const runDirectory = makeRunDirectory(root);
const capturePath = `${runDirectory}/stable-scroll-indicator.jsonl`;

type IndicatorCapture = {
  column: number;
  indicatorWidth: number;
  scrollbarVisible: boolean;
  terminalWidth: number;
};

function captures(): IndicatorCapture[] {
  if (!existsSync(capturePath)) return [];
  return readFileSync(capturePath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as IndicatorCapture);
}

try {
  const harness = await PiTuiHarness.start({
    name: "stable-scroll-indicator",
    root,
    runDirectory,
    extensions: [
      "extensions/stable-scroll-indicator.ts",
      "extensions/test/e2e/fixture/stable-scroll-indicator-probe.ts",
    ],
    cliArguments: ["--tui-mode", "fullscreen"],
    environment: { PI_E2E_SCROLL_INDICATOR_CAPTURE: capturePath },
    settings: { fullscreenScrollbar: "auto" },
    width: 90,
  });

  try {
    await harness.waitFor("STABLE SCROLL INDICATOR PROBE READY");
    await harness.submitCommand("e2e-scroll-indicator-seed");
    await harness.waitFor("SCROLL INDICATOR PROBE LINE 79");
    await harness.sendKeys("PageUp");
    await harness.waitFor("Jump to latest message");
    await harness.waitUntil("hidden automatic scrollbar", () =>
      captures().some((capture) => !capture.scrollbarVisible),
    );

    const hidden = captures().findLast((capture) => !capture.scrollbarVisible);
    harness.assert(
      hidden,
      "Hidden-scrollbar indicator geometry was not captured",
    );

    const beforeReappearance = captures().length;
    await harness.sendKeys("PageUp");
    await harness.waitUntil("visible automatic scrollbar", () =>
      captures()
        .slice(beforeReappearance)
        .some(
          (capture) =>
            capture.scrollbarVisible &&
            capture.terminalWidth === hidden.terminalWidth,
        ),
    );
    const visible = captures()
      .slice(beforeReappearance)
      .findLast(
        (capture) =>
          capture.scrollbarVisible &&
          capture.terminalWidth === hidden.terminalWidth,
      );
    harness.assert(
      visible,
      "Visible-scrollbar indicator geometry was not captured",
    );
    harness.assert(
      visible.column === hidden.column,
      `PRODUCT DEFECT: Jump-to-latest indicator moved from column ${hidden.column} to ${visible.column} when the scrollbar reappeared`,
    );

    await harness.finish();
    console.log(
      "PASS stable-scroll-indicator: automatic scrollbar does not move jump overlay",
    );
  } finally {
    await harness.abort().catch(() => undefined);
  }
} finally {
  await cleanupRun(runDirectory);
}
