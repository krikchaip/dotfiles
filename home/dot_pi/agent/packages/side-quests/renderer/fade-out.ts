import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  sliceByColumn,
  stripTerminalSequences,
  visibleWidth,
} from "@earendil-works/pi-tui";

import { terminalForeground } from "./terminal-foreground.ts";

const FADE_CELL_COUNT = 13;
const FADE_END_PROGRESS = 0.78;
const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

type Rgb = Readonly<{ r: number; g: number; b: number }>;
type FadeSourceColor = "customMessageText" | "muted";

/** Adds a terminal-cell fade to collapsed text that ends in an ellipsis. */
export function fadeOut(
  component: Component,
  theme: Theme,
  sourceColor: FadeSourceColor,
): Component {
  return new FadeOut(component, theme, sourceColor);
}

/** Fades one rendered line while preserving its visible text and cell width. */
export function fadeOutLineEnding(
  line: string,
  theme: Theme,
  sourceColor: FadeSourceColor,
): string {
  if (typeof theme.getFgAnsi !== "function") return line;

  const plain = stripTerminalSequences(line);
  const ellipsisIndex = plain.lastIndexOf("…");
  if (ellipsisIndex < 0) return line;
  const content = plain.slice(0, ellipsisIndex + 1);

  const graphemes = Array.from(graphemeSegmenter.segment(content), (item) => ({
    width: visibleWidth(item.segment),
  }));
  let fadeWidth = 0;
  let fadeStartIndex = graphemes.length;

  while (fadeStartIndex > 0 && fadeWidth < FADE_CELL_COUNT) {
    const candidate = graphemes[fadeStartIndex - 1];
    if (!candidate) break;
    fadeWidth += candidate.width;
    fadeStartIndex -= 1;
  }

  if (fadeWidth === 0) return line;

  const contentWidth = visibleWidth(content);
  const fadeStart = contentWidth - fadeWidth;
  const prefix = sliceByColumn(line, 0, fadeStart, true);
  const styledEnding = sliceByColumn(line, fadeStart, fadeWidth, true);
  const suffix = renderedSuffix(line, contentWidth);
  const fadedGraphemes = graphemes.slice(fadeStartIndex);
  const fallbackForeground =
    parseColor(theme.getFgAnsi(sourceColor), "foreground") ??
    terminalForeground(theme);
  const colors = gradientColors(
    theme,
    sourceColor,
    fadedGraphemes,
    graphemeForegrounds(styledEnding, fallbackForeground),
    fallbackForeground,
  );
  const ending = colorizeGraphemes(styledEnding, colors);

  return `${prefix}${ending}${suffix}\u001b[39m`;
}

class FadeOut implements Component {
  public constructor(
    private readonly component: Component,
    private readonly theme: Theme,
    private readonly sourceColor: FadeSourceColor,
  ) {}

  public render(width: number): string[] {
    const lines = [...this.component.render(width)];
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      if (!line || !stripTerminalSequences(line).includes("…")) continue;
      lines[index] = fadeOutLineEnding(line, this.theme, this.sourceColor);
      break;
    }
    return lines;
  }

  public invalidate(): void {
    this.component.invalidate();
  }
}

function gradientColors(
  theme: Theme,
  sourceColor: FadeSourceColor,
  graphemes: readonly Readonly<{ width: number }>[],
  activeForegrounds: readonly (Rgb | undefined)[],
  fallbackForeground: Rgb | undefined,
): readonly string[] {
  const background = parseColor(
    theme.getBgAnsi("customMessageBg"),
    "background",
  );
  const totalWidth = graphemes.reduce(
    (sum, grapheme) => sum + grapheme.width,
    0,
  );
  let elapsedWidth = 0;

  return graphemes.map((grapheme, index) => {
    elapsedWidth += grapheme.width;
    const progress =
      totalWidth === 0
        ? FADE_END_PROGRESS
        : (elapsedWidth / totalWidth) * FADE_END_PROGRESS;
    const foreground = activeForegrounds[index] ?? fallbackForeground;

    if (foreground && background) {
      return foregroundAnsi(
        blend(foreground, background, progress),
        theme.getColorMode(),
      );
    }

    return theme.getFgAnsi(semanticTone(elapsedWidth, totalWidth));
  });
}

function graphemeForegrounds(
  styledText: string,
  fallback: Rgb | undefined,
): readonly (Rgb | undefined)[] {
  const foregrounds: Array<Rgb | undefined> = [];
  let foreground = fallback;
  let index = 0;

  while (index < styledText.length) {
    const sequence = terminalSequenceAt(styledText, index);
    if (sequence) {
      const parsed = parseColor(sequence, "foreground");
      if (parsed) foreground = parsed;
      else if (resetsForeground(sequence)) foreground = fallback;
      index += sequence.length;
      continue;
    }

    let textEnd = index;
    while (
      textEnd < styledText.length &&
      !terminalSequenceAt(styledText, textEnd)
    )
      textEnd += 1;

    for (const _ of graphemeSegmenter.segment(styledText.slice(index, textEnd)))
      foregrounds.push(foreground);
    index = textEnd;
  }

  return foregrounds;
}

function resetsForeground(ansi: string): boolean {
  if (!ansi.startsWith("\u001b[") || !ansi.endsWith("m")) return false;
  const parameters = ansi.slice(2, -1).split(";").map(Number);
  return (
    parameters.length === 0 || parameters.includes(0) || parameters.includes(39)
  );
}

function semanticTone(elapsedWidth: number, totalWidth: number): ThemeColor {
  const third = totalWidth / 3;
  if (elapsedWidth <= third) return "customMessageText";
  if (elapsedWidth <= third * 2) return "muted";
  return "dim";
}

function colorizeGraphemes(
  styledText: string,
  colors: readonly string[],
): string {
  let colorIndex = 0;
  let index = 0;
  let result = "";

  while (index < styledText.length) {
    const sequence = terminalSequenceAt(styledText, index);
    if (sequence) {
      result += sequence;
      index += sequence.length;
      continue;
    }

    let textEnd = index;
    while (
      textEnd < styledText.length &&
      !terminalSequenceAt(styledText, textEnd)
    )
      textEnd += 1;

    for (const { segment } of graphemeSegmenter.segment(
      styledText.slice(index, textEnd),
    )) {
      result += `${colors[colorIndex] ?? colors.at(-1) ?? ""}${segment}`;
      colorIndex += 1;
    }
    index = textEnd;
  }

  return result;
}

function terminalSequenceAt(text: string, index: number): string | undefined {
  if (text[index] !== "\u001b") return undefined;

  if (text[index + 1] === "[") {
    for (let end = index + 2; end < text.length; end += 1) {
      const code = text.charCodeAt(end);
      if (code >= 0x40 && code <= 0x7e) return text.slice(index, end + 1);
    }
    return undefined;
  }

  if (text[index + 1] === "]" || text[index + 1] === "_") {
    for (let end = index + 2; end < text.length; end += 1) {
      if (text[end] === "\u0007") return text.slice(index, end + 1);
      if (text[end] === "\u001b" && text[end + 1] === "\\")
        return text.slice(index, end + 2);
    }
  }

  return undefined;
}

function renderedSuffix(line: string, startColumn: number): string {
  let column = 0;
  let index = 0;
  let result = "";

  while (index < line.length) {
    const sequence = terminalSequenceAt(line, index);
    if (sequence) {
      if (column >= startColumn) result += sequence;
      index += sequence.length;
      continue;
    }

    let textEnd = index;
    while (textEnd < line.length && !terminalSequenceAt(line, textEnd))
      textEnd += 1;

    for (const { segment } of graphemeSegmenter.segment(
      line.slice(index, textEnd),
    )) {
      if (column >= startColumn) result += segment;
      column += visibleWidth(segment);
    }
    index = textEnd;
  }

  return result;
}

function parseColor(
  ansi: string,
  target: "foreground" | "background",
): Rgb | undefined {
  if (!ansi.startsWith("\u001b[") || !ansi.endsWith("m")) return undefined;

  const prefix = target === "foreground" ? 38 : 48;
  const parameters = ansi.slice(2, -1).split(";").map(Number);
  const prefixIndex = parameters.indexOf(prefix);
  if (prefixIndex < 0) return undefined;

  if (parameters[prefixIndex + 1] === 2) {
    const [r, g, b] = parameters.slice(prefixIndex + 2, prefixIndex + 5);
    if (r !== undefined && g !== undefined && b !== undefined)
      return { r, g, b };
  }

  if (parameters[prefixIndex + 1] === 5) {
    const index = parameters[prefixIndex + 2];
    return index === undefined ? undefined : xtermColor(index);
  }

  return undefined;
}

function blend(from: Rgb, to: Rgb, progress: number): Rgb {
  const channel = (start: number, end: number) =>
    Math.round(start + (end - start) * progress);

  return {
    r: channel(from.r, to.r),
    g: channel(from.g, to.g),
    b: channel(from.b, to.b),
  };
}

function foregroundAnsi(rgb: Rgb, mode: "truecolor" | "256color"): string {
  if (mode === "truecolor") return `\u001b[38;2;${rgb.r};${rgb.g};${rgb.b}m`;

  return `\u001b[38;5;${closestXtermColor(rgb)}m`;
}

function xtermColor(index: number): Rgb | undefined {
  const basic: readonly Rgb[] = [
    { r: 0, g: 0, b: 0 },
    { r: 128, g: 0, b: 0 },
    { r: 0, g: 128, b: 0 },
    { r: 128, g: 128, b: 0 },
    { r: 0, g: 0, b: 128 },
    { r: 128, g: 0, b: 128 },
    { r: 0, g: 128, b: 128 },
    { r: 192, g: 192, b: 192 },
    { r: 128, g: 128, b: 128 },
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 255, b: 0 },
    { r: 255, g: 255, b: 0 },
    { r: 0, g: 0, b: 255 },
    { r: 255, g: 0, b: 255 },
    { r: 0, g: 255, b: 255 },
    { r: 255, g: 255, b: 255 },
  ];
  if (index >= 0 && index < 16) return basic[index];
  if (index >= 16 && index <= 231) {
    const offset = index - 16;
    const levels = [0, 95, 135, 175, 215, 255] as const;
    return {
      r: levels[Math.floor(offset / 36)] ?? 0,
      g: levels[Math.floor((offset % 36) / 6)] ?? 0,
      b: levels[offset % 6] ?? 0,
    };
  }
  if (index >= 232 && index <= 255) {
    const level = 8 + (index - 232) * 10;
    return { r: level, g: level, b: level };
  }
  return undefined;
}

function closestXtermColor(rgb: Rgb): number {
  let closest = 0;
  let shortestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index <= 255; index += 1) {
    const candidate = xtermColor(index);
    if (!candidate) continue;
    const distance =
      (rgb.r - candidate.r) ** 2 * 0.299 +
      (rgb.g - candidate.g) ** 2 * 0.587 +
      (rgb.b - candidate.b) ** 2 * 0.114;
    if (distance < shortestDistance) {
      shortestDistance = distance;
      closest = index;
    }
  }

  return closest;
}
