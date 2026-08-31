/**
 * Highlight exact `#RRGGBB` tokens in all visible Pi TUI text.
 *
 * The extension patches Pi's final line normalization seam. This keeps normal
 * and fullscreen modes consistent while preserving terminal control data,
 * image payloads, cursor styles, and text selection styles.
 */

import {
  CustomEditor,
  type ExtensionAPI,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorComponent, EditorTheme, TUI } from "@earendil-works/pi-tui";

const TUI_PATCH_STATE = Symbol.for("color-highlight.tui-render.patch");
const EDITOR_FACTORY_STATE = Symbol.for("color-highlight.editor-factory.patch");

const HEX_COLOR_PATTERN = /#[0-9a-f]{6}(?![0-9a-f])/gi;
const RESET_FOREGROUND = "\x1b[39m";
const RESET_BACKGROUND = "\x1b[49m";
const HIGHLIGHT_SEQUENCE_CACHE = new Map<
  string,
  { foreground: string; background: string }
>();

type ColorMode = "truecolor" | "256color";
type EditorFactory = (
  tui: TUI,
  theme: EditorTheme,
  keybindings: KeybindingsManager,
) => EditorComponent;
type ApplyLineResets = (lines: string[]) => string[];

type StyleState = {
  foreground: string;
  background: string;
  inverse: boolean;
};

type TuiPatchState = {
  originalApplyLineResets: ApplyLineResets;
  installedApplyLineResets?: ApplyLineResets;
  getColorMode: () => ColorMode;
  reportError: (error: unknown) => void;
};

type TuiRenderInternals = TUI & {
  applyLineResets?: ApplyLineResets;
  [TUI_PATCH_STATE]?: TuiPatchState;
};

type TaggedEditorFactory = EditorFactory & {
  [EDITOR_FACTORY_STATE]?: { previous?: EditorFactory };
};

/**
 * Return the index after the ANSI escape sequence at the given offset.
 */
function escapeEnd(text: string, start: number): number {
  if (text[start] !== "\x1b") return start + 1;

  const kind = text[start + 1];
  if (kind === "[") {
    for (let i = start + 2; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code >= 0x40 && code <= 0x7e) return i + 1;
    }
    return text.length;
  }

  if (["]", "_", "P", "^", "X"].includes(kind ?? "")) {
    const bel = text.indexOf("\x07", start + 2);
    const stringTerminator = text.indexOf("\x1b\\", start + 2);
    if (bel === -1) {
      return stringTerminator === -1 ? text.length : stringTerminator + 2;
    }
    if (stringTerminator === -1) return bel + 1;
    return Math.min(bel + 1, stringTerminator + 2);
  }

  return Math.min(start + 2, text.length);
}

/**
 * Parse semicolon-delimited SGR parameters from an ANSI sequence.
 */
function sgrCodes(sequence: string): number[] {
  if (!sequence.startsWith("\x1b[") || !sequence.endsWith("m")) return [];

  const body = sequence.slice(2, -1);
  if (body === "") return [0];
  if (body.includes(":")) return [];

  return body
    .split(";")
    .map((part) => Number(part || "0"))
    .filter((code) => Number.isFinite(code));
}

/**
 * Build an extended foreground or background SGR color sequence.
 */
function colorSequence(kind: 38 | 48, values: number[]): string {
  return `\x1b[${[kind, ...values].join(";")}m`;
}

/**
 * Apply one SGR sequence to the tracked foreground, background, and inverse state.
 */
function updateStyleState(sequence: string, state: StyleState): void {
  const codes = sgrCodes(sequence);

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]!;

    if (code === 0) {
      state.foreground = RESET_FOREGROUND;
      state.background = RESET_BACKGROUND;
      state.inverse = false;
      continue;
    }

    if (code === 7) {
      state.inverse = true;
      continue;
    }
    if (code === 27) {
      state.inverse = false;
      continue;
    }

    if (code === 39) {
      state.foreground = RESET_FOREGROUND;
      continue;
    }
    if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
      state.foreground = `\x1b[${code}m`;
      continue;
    }

    if (code === 49) {
      state.background = RESET_BACKGROUND;
      continue;
    }
    if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
      state.background = `\x1b[${code}m`;
      continue;
    }

    if (code !== 38 && code !== 48) continue;

    const mode = codes[i + 1];
    if (mode === 5 && codes[i + 2] !== undefined) {
      const sequenceForColor = colorSequence(code, [5, codes[i + 2]!]);
      if (code === 38) state.foreground = sequenceForColor;
      else state.background = sequenceForColor;
      i += 2;
      continue;
    }

    if (
      mode === 2 &&
      codes[i + 2] !== undefined &&
      codes[i + 3] !== undefined &&
      codes[i + 4] !== undefined
    ) {
      const sequenceForColor = colorSequence(code, [
        2,
        codes[i + 2]!,
        codes[i + 3]!,
        codes[i + 4]!,
      ]);
      if (code === 38) state.foreground = sequenceForColor;
      else state.background = sequenceForColor;
      i += 4;
    }
  }
}

/**
 * Remove terminal control data and return only visible text.
 */
function visibleText(text: string): string {
  let visible = "";

  for (let i = 0; i < text.length;) {
    const code = text.charCodeAt(i);
    if (text[i] === "\x1b") {
      i = escapeEnd(text, i);
      continue;
    }
    if (code < 0x20 || code === 0x7f) {
      i++;
      continue;
    }

    const codePoint = text.codePointAt(i);
    if (codePoint === undefined) break;
    const char = String.fromCodePoint(codePoint);
    visible += char;
    i += char.length;
  }

  return visible;
}

/**
 * Map each UTF-16 offset in an exact hex token to its parsed RGB value.
 */
function highlightedPositions(
  text: string,
): Map<number, [number, number, number]> {
  const positions = new Map<number, [number, number, number]>();

  for (const match of text.matchAll(HEX_COLOR_PATTERN)) {
    if (match.index === undefined) continue;
    const value = match[0].slice(1);
    const rgb: [number, number, number] = [
      Number.parseInt(value.slice(0, 2), 16),
      Number.parseInt(value.slice(2, 4), 16),
      Number.parseInt(value.slice(4, 6), 16),
    ];
    for (let i = match.index; i < match.index + match[0].length; i++) {
      positions.set(i, rgb);
    }
  }

  return positions;
}

/**
 * Convert an xterm 256-color palette index to its RGB value.
 */
function xtermColor(index: number): [number, number, number] {
  if (index >= 232) {
    const level = 8 + (index - 232) * 10;
    return [level, level, level];
  }

  const cubeIndex = index - 16;
  const levels = [0, 95, 135, 175, 215, 255];
  return [
    levels[Math.floor(cubeIndex / 36)]!,
    levels[Math.floor((cubeIndex % 36) / 6)]!,
    levels[cubeIndex % 6]!,
  ];
}

/**
 * Find the nearest xterm 256-color palette entry for an RGB value.
 */
function nearestXtermColor(rgb: [number, number, number]): {
  index: number;
  rgb: [number, number, number];
} {
  let bestIndex = 16;
  let bestRgb = xtermColor(bestIndex);
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 16; index <= 255; index++) {
    const candidate = xtermColor(index);
    const distance = candidate.reduce(
      (sum, channel, channelIndex) => sum + (channel - rgb[channelIndex]!) ** 2,
      0,
    );
    if (distance < bestDistance) {
      bestIndex = index;
      bestRgb = candidate;
      bestDistance = distance;
    }
  }

  return { index: bestIndex, rgb: bestRgb };
}

/**
 * Convert one sRGB channel to linear light for luminance calculation.
 */
function linearChannel(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/**
 * Select black or white text with the higher contrast against a background.
 */
function readableForeground(rgb: [number, number, number]): "black" | "white" {
  const luminance =
    0.2126 * linearChannel(rgb[0]) +
    0.7152 * linearChannel(rgb[1]) +
    0.0722 * linearChannel(rgb[2]);
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);
  return blackContrast >= whiteContrast ? "black" : "white";
}

/**
 * Return cached foreground and background sequences for a color mode.
 */
function highlightSequences(
  rgb: [number, number, number],
  mode: ColorMode,
): { foreground: string; background: string } {
  const cacheKey = `${mode}:${rgb.join(",")}`;
  const cached = HIGHLIGHT_SEQUENCE_CACHE.get(cacheKey);
  if (cached) return cached;

  let sequences: { foreground: string; background: string };
  if (mode === "truecolor") {
    const foreground = readableForeground(rgb) === "black" ? 0 : 255;
    sequences = {
      foreground: `\x1b[38;2;${foreground};${foreground};${foreground}m`,
      background: `\x1b[48;2;${rgb.join(";")}m`,
    };
  } else {
    const nearest = nearestXtermColor(rgb);
    const foreground = readableForeground(nearest.rgb) === "black" ? 16 : 231;
    sequences = {
      foreground: `\x1b[38;5;${foreground}m`,
      background: `\x1b[48;5;${nearest.index}m`,
    };
  }

  HIGHLIGHT_SEQUENCE_CACHE.set(cacheKey, sequences);
  return sequences;
}

/**
 * Test whether a line contains a Kitty or iTerm2 image payload.
 */
function isImageLine(line: string): boolean {
  return line.includes("\x1b_G") || line.includes("\x1b]1337;File=");
}

/**
 * Highlight exact hex tokens in one rendered line without changing visible width.
 */
function colorizeLine(line: string, mode: ColorMode): string {
  if (isImageLine(line)) return line;

  const positions = highlightedPositions(visibleText(line));
  if (positions.size === 0) return line;

  const state: StyleState = {
    foreground: RESET_FOREGROUND,
    background: RESET_BACKGROUND,
    inverse: false,
  };
  let result = "";
  let visibleIndex = 0;

  for (let i = 0; i < line.length;) {
    const code = line.charCodeAt(i);
    if (line[i] === "\x1b") {
      const end = escapeEnd(line, i);
      const sequence = line.slice(i, end);
      result += sequence;
      updateStyleState(sequence, state);
      i = end;
      continue;
    }
    if (code < 0x20 || code === 0x7f) {
      result += line[i];
      i++;
      continue;
    }

    const codePoint = line.codePointAt(i);
    if (codePoint === undefined) break;
    const char = String.fromCodePoint(codePoint);
    const rgb = positions.get(visibleIndex);

    if (rgb && !state.inverse) {
      const highlight = highlightSequences(rgb, mode);
      result +=
        highlight.foreground +
        highlight.background +
        char +
        state.foreground +
        state.background;
    } else {
      result += char;
    }

    visibleIndex += char.length;
    i += char.length;
  }

  return result;
}

/**
 * Highlight every non-image line in a rendered TUI frame.
 */
function colorizeLines(lines: string[], mode: ColorMode): string[] {
  return lines.map((line) => colorizeLine(line, mode));
}

/**
 * Patch Pi's shared final-line seam for normal and fullscreen rendering.
 */
function patchTui(
  tui: TUI,
  getColorMode: () => ColorMode,
  reportError: (error: unknown) => void,
): void {
  const target = tui as TuiRenderInternals;
  const existing = target[TUI_PATCH_STATE];
  if (existing) {
    existing.getColorMode = getColorMode;
    existing.reportError = reportError;
    return;
  }

  if (typeof target.applyLineResets !== "function") {
    throw new Error("Pi TUI final line render API not found");
  }

  const state: TuiPatchState = {
    originalApplyLineResets: target.applyLineResets,
    getColorMode,
    reportError,
  };
  target[TUI_PATCH_STATE] = state;

  /**
   * Normalize a frame, then add color highlights before terminal output.
   */
  target.applyLineResets = function colorHighlightApplyLineResets(
    lines: string[],
  ) {
    const normalizedLines = state.originalApplyLineResets.call(this, lines);
    try {
      return colorizeLines(normalizedLines, state.getColorMode());
    } catch (error) {
      state.reportError(error);
      return normalizedLines;
    }
  };
  state.installedApplyLineResets = target.applyLineResets;
}

/**
 * Restore Pi's original final-line method when this extension unloads.
 */
function unpatchTui(tui: TUI): void {
  const target = tui as TuiRenderInternals;
  const state = target[TUI_PATCH_STATE];
  if (!state) return;

  if (target.applyLineResets === state.installedApplyLineResets) {
    target.applyLineResets = state.originalApplyLineResets;
  }

  if (target.applyLineResets === state.originalApplyLineResets) {
    delete target[TUI_PATCH_STATE];
  }
}

/**
 * Register the global color highlighter and its session lifecycle hooks.
 */
export default function colorHighlightExtension(pi: ExtensionAPI): void {
  let activeTui: TUI | undefined;
  let reportedError = false;
  /**
   * Report only the first render failure so Pi can continue without log spam.
   */
  const reportError = (error: unknown) => {
    if (reportedError) return;
    reportedError = true;
    console.error("color-highlight: disabled after render failure", error);
  };

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    const configuredFactory = ctx.ui.getEditorComponent() as
      TaggedEditorFactory | undefined;
    const configuredState = configuredFactory?.[EDITOR_FACTORY_STATE];
    const previousFactory = configuredState
      ? configuredState.previous
      : configuredFactory;

    /**
     * Preserve the active editor factory and install the shared TUI patch.
     */
    const factory: TaggedEditorFactory = (tui, theme, keybindings) => {
      const editor = previousFactory
        ? previousFactory(tui, theme, keybindings)
        : new CustomEditor(tui, theme, keybindings);

      try {
        patchTui(tui, () => ctx.ui.theme.getColorMode(), reportError);
        activeTui = tui;
      } catch (error) {
        reportError(error);
      }

      return editor;
    };
    factory[EDITOR_FACTORY_STATE] = { previous: previousFactory };
    ctx.ui.setEditorComponent(factory);
  });

  pi.on("session_shutdown", () => {
    if (!activeTui) return;
    unpatchTui(activeTui);
    activeTui = undefined;
  });
}
