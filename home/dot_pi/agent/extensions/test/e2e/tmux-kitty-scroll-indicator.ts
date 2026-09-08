import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanupRun, makeRunDirectory, PiTuiHarness } from "./harness.ts";

const root = resolve(import.meta.dir, "../../..");
const runDirectory = makeRunDirectory(root);
const capturePath = `${runDirectory}/tmux-kitty-scroll-indicator.json`;
const PLACEHOLDER = String.fromCodePoint(0x10eeee);
const RESET_OSC = "\x1b[0m\x1b]8;;\x07";

type Capture = {
  baseLine: string;
  resultLine: string;
  baseWidth: number;
  resultWidth: number;
  basePlaceholders: number;
  resultPlaceholders: number;
  rect: { row: number; column: number; width: number };
  terminalWidth: number;
  scrollbarVisible: boolean;
};

function captures(): Capture[] {
  if (!existsSync(capturePath)) return [];
  return readFileSync(capturePath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Capture);
}

try {
  const harness = await PiTuiHarness.start({
    name: "tmux-kitty-scroll-indicator",
    root,
    runDirectory,
    extensions: [
      "extensions/stable-scroll-indicator.ts",
      "extensions/tmux-kitty-images.ts",
      "extensions/test/e2e/fixture/tmux-kitty-scroll-indicator-probe.ts",
    ],
    cliArguments: ["--tui-mode", "fullscreen"],
    environment: {
      KITTY_WINDOW_ID: "1",
      PI_E2E_TMUX_SCROLL_INDICATOR_CAPTURE: capturePath,
      TERM: "tmux-256color",
      TERM_PROGRAM: "kitty",
    },
    settings: { fullscreenScrollbar: "hidden" },
    width: 90,
  });

  try {
    await harness.waitFor("TMUX KITTY SCROLL INDICATOR PROBE READY");
    await harness.submitCommand("e2e-tmux-scroll-indicator-seed");
    await harness.waitFor("AFTER IMAGE 47");

    for (let page = 0; page < 6 && !existsSync(capturePath); page += 1) {
      await harness.sendKeys("PageUp");
      await Bun.sleep(200);
    }
    await harness.waitUntil(
      "jump-to-latest indicator overlapping a U=1 image row",
      () => existsSync(capturePath),
    );

    const capture = captures()[0];
    harness.assert(capture, "Image row was not captured");
    harness.assert(
      capture.baseWidth <= capture.terminalWidth &&
        capture.resultWidth === capture.terminalWidth,
      `Composed line width is invalid: ${capture.baseWidth} -> ${capture.resultWidth}, terminal ${capture.terminalWidth}`,
    );
    harness.assert(
      capture.resultPlaceholders ===
        capture.basePlaceholders - capture.rect.width,
      `Indicator replaced the wrong number of placeholders: ${capture.basePlaceholders} -> ${capture.resultPlaceholders}, indicator width ${capture.rect.width}`,
    );

    const metadata = capture.baseLine.match(
      /(\x1b\[38;2;\d+;\d+;\d+m)(\x1b\[58;2;\d+;\d+;\d+m)/,
    );
    harness.assert(metadata, "Base image row has no Kitty U=1 ID metadata");
    const indicatorIndex = capture.resultLine.indexOf("Jump to latest message");
    const trailingPlaceholderIndex = capture.resultLine.indexOf(
      PLACEHOLDER,
      indicatorIndex,
    );
    harness.assert(
      indicatorIndex >= 0 && trailingPlaceholderIndex >= 0,
      "Fullscreen indicator did not leave a trailing image region",
    );
    const trailingPrefix = capture.resultLine.slice(
      Math.max(
        capture.resultLine.lastIndexOf(RESET_OSC, trailingPlaceholderIndex),
        0,
      ),
      trailingPlaceholderIndex,
    );
    const expectedMetadata = `${metadata![1]}${metadata![2]}`;
    harness.assert(
      trailingPrefix.includes(expectedMetadata),
      `PRODUCT DEFECT: fullscreen scroll indicator corrupted trailing Kitty placement metadata\nexpected ${JSON.stringify(expectedMetadata)}\nactual ${JSON.stringify(trailingPrefix)}`,
    );


    await harness.finish();
    console.log(
      "PASS tmux-kitty-scroll-indicator: trailing image cells keep Kitty IDs",
    );
  } finally {
    await harness.abort().catch(() => undefined);
  }
} finally {
  await cleanupRun(runDirectory);
}
