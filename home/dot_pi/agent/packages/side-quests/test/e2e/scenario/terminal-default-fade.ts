import { configureBasicDelegation } from "../provider-support.ts";

type Rgb = Readonly<{ r: number; g: number; b: number }>;

const FADE_TEXT = "ABCDEFGHIJKL…";
const resultStart = "Terminal-default foreground coverage: ";
const resultEnding = FADE_TEXT.slice(0, -1);
const resultPadding = "x".repeat(
  240 - Array.from(`${resultStart}${resultEnding}`).length,
);
const longResult = `${resultStart}${resultPadding}${resultEnding}\n\nExpanded terminal-default marker.`;
const QUERIED_FOREGROUND = { r: 192, g: 202, b: 245 } as const;

function foregroundsFor(view: string, target: string): readonly Rgb[] {
  const characters: string[] = [];
  const foregrounds: Array<Rgb | undefined> = [];
  let foreground: Rgb | undefined;
  let index = 0;

  while (index < view.length) {
    if (view[index] === "\u001b" && view[index + 1] === "[") {
      const end = view.indexOf("m", index + 2);
      if (end < 0) break;
      const parameters = view
        .slice(index + 2, end)
        .split(";")
        .map(Number);
      const colorIndex = parameters.indexOf(38);
      if (colorIndex >= 0 && parameters[colorIndex + 1] === 2) {
        const [r, g, b] = parameters.slice(colorIndex + 2, colorIndex + 5);
        if (r !== undefined && g !== undefined && b !== undefined)
          foreground = { r, g, b };
      } else if (parameters.includes(39) || parameters.includes(0)) {
        foreground = undefined;
      }
      index = end + 1;
      continue;
    }

    characters.push(view[index] ?? "");
    foregrounds.push(foreground);
    index += 1;
  }

  const targetIndex = characters.join("").indexOf(target);
  if (targetIndex < 0) return [];
  return foregrounds
    .slice(targetIndex, targetIndex + target.length)
    .filter((color): color is Rgb => color !== undefined);
}

function distance(left: Rgb, right: Rgb): number {
  return Math.hypot(left.r - right.r, left.g - right.g, left.b - right.b);
}

export const terminalDefaultFade: Scenario = {
  name: "terminal-default-fade",
  process: {
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
    settings: { theme: "dark-cavern" },
    terminalForegroundResponse: "\u001b]10;rgb:c0c0/caca/f5f5\u0007",
    themeFixture: "../oh-my-pi-themes/themes/dark-cavern.json",
  },
  configureProvider(context) {
    configureBasicDelegation(context, {
      childResponse: longResult,
      prompt: "Complete the terminal-default fade E2E.",
    });
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("SUBAGENT COMPLETED");
    const ansiView = await harness.tmux(
      "capture-pane",
      "-p",
      "-e",
      "-J",
      "-t",
      harness.parentPane,
      "-S",
      "-",
    );
    const foregrounds = foregroundsFor(ansiView, FADE_TEXT);
    const first = foregrounds[0];
    const last = foregrounds.at(-1);

    harness.assert(
      foregrounds.length === Array.from(FADE_TEXT).length &&
        first !== undefined &&
        last !== undefined &&
        distance(first, QUERIED_FOREGROUND) < 25 &&
        distance(last, QUERIED_FOREGROUND) > 100,
      `The collapsed result did not fade from the queried terminal foreground.\n${ansiView}`,
    );
  },
};
