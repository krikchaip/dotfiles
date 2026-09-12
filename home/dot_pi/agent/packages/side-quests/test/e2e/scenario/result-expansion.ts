import { configureBasicDelegation } from "../provider-support.ts";

type Rgb = Readonly<{ r: number; g: number; b: number }>;

const COLORED_ENDING = "chromatic-fade-token";
const resultPrefix = [
  "### Result rendering",
  "",
  "**Markdown marker** with `Agent` output.",
  "",
  "Colored suffix: ",
].join("\n");
const inlineCodeEnding = ` \`${COLORED_ENDING}\``;
const padding = "x".repeat(
  240 - Array.from(`${resultPrefix}${inlineCodeEnding}`).length,
);
const longResult = [
  `${resultPrefix}${padding}${inlineCodeEnding}`,
  "",
  "| State | Tone |",
  "| --- | --- |",
  "| completed | green |",
  "",
  "Expanded result marker.",
].join("\n");

function coloredTextForegrounds(view: string, target: string): readonly Rgb[] {
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
      } else if (parameters.includes(39) || parameters.length === 0) {
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

function colorDistance(left: Rgb, right: Rgb): number {
  return Math.hypot(left.r - right.r, left.g - right.g, left.b - right.b);
}

export const resultExpansion: Scenario = {
  name: "result-expansion",
  process: { managed: true, positionalPrompt: "Delegate this E2E task now." },
  configureProvider(context) {
    configureBasicDelegation(context, {
      childResponse: longResult,
      prompt: "Complete the result expansion E2E.",
    });
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("SUBAGENT COMPLETED");

    const collapsed = await harness.capture();

    harness.assert(
      collapsed.includes("Markdown marker") &&
        !collapsed.includes("**Markdown marker**") &&
        !collapsed.includes("`Agent`"),
      `The collapsed result did not render inline Markdown.\n${collapsed}`,
    );
    harness.assert(
      collapsed.includes("…") && !collapsed.includes("to expand"),
      `The collapsed result did not end with the faded ellipsis.\n${collapsed}`,
    );
    harness.assert(
      !collapsed.includes("Expanded result marker."),
      `The collapsed result showed its complete long response.\n${collapsed}`,
    );

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
    const coloredForegrounds = coloredTextForegrounds(ansiView, COLORED_ENDING);
    const sourceForeground = coloredForegrounds[0];
    const firstFadedForeground = coloredForegrounds.find(
      (color) =>
        sourceForeground !== undefined &&
        colorDistance(sourceForeground, color) > 0,
    );
    harness.assert(
      sourceForeground !== undefined &&
        firstFadedForeground !== undefined &&
        colorDistance(sourceForeground, firstFadedForeground) < 30,
      `The fade jumped from the Markdown token color instead of fading smoothly.\n${ansiView}`,
    );

    await harness.sendParentKeys("C-o");
    const expanded = await harness.waitFor("Expanded result marker.", 5_000);
    harness.assert(
      expanded.includes("┌") && expanded.includes("│ State"),
      `The expanded result did not render the Markdown table.\n${expanded}`,
    );
    await harness.waitFor("session path:", 5_000);
  },
};
