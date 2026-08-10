/**
 * Prevents rendered text from replaying terminal control sequences.
 *
 * Components can render ANSI colors and hyperlinks. Tool output can also
 * contain captured cursor movement, erasure, and screen-state controls. Pi's
 * TUI must not send those captured controls back to the terminal.
 */

import {
  ToolExecutionComponent,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
  Markdown,
  Text,
  truncateToWidth,
  TuiMainScreen,
  visibleWidth,
} from "@earendil-works/pi-tui";

const TUI_PATCH_STATE = Symbol.for("safe-terminal-output.tui.patch");
const TEXT_PATCH_STATE = Symbol.for("safe-terminal-output.text.patch");
const MARKDOWN_PATCH_STATE = Symbol.for("safe-terminal-output.markdown.patch");
const TOOL_RESULT_PATCH_STATE = Symbol.for(
  "safe-terminal-output.tool-result.patch",
);
const ESC = "\x1b";
const BEL = "\x07";
const ST = "\x9c";

type ApplyLineResets = (lines: string[]) => string[];
type Render = (width: number) => string[];

type TuiPatchState = {
  originalApplyLineResets: ApplyLineResets;
};

type RenderPatchState = {
  originalRender: Render;
};

type ToolResultContent = {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
};

type ToolResult = {
  content: ToolResultContent[];
  details?: unknown;
  isError: boolean;
};

type UpdateResult = (result: ToolResult, isPartial?: boolean) => void;

type ToolResultPatchState = {
  originalUpdateResult: UpdateResult;
};

type TuiInternals = {
  applyLineResets: ApplyLineResets;
  terminal: { columns: number };
};

type TuiPrototype = TuiInternals & {
  [TUI_PATCH_STATE]?: TuiPatchState;
};

type TextRenderer = {
  text: string;
  render: Render;
};

type ToolResultRenderer = {
  updateResult: UpdateResult;
};

function isImageLine(line: string): boolean {
  // Match pi-tui's image-line boundary. These lines intentionally contain
  // Kitty APC or iTerm2 OSC controls and must reach the terminal unchanged.
  return line.includes(`${ESC}_G`) || line.includes(`${ESC}]1337;File=`);
}

function stringSequenceEnd(
  text: string,
  start: number,
): { end: number; terminated: boolean } {
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === BEL || text[i] === ST) {
      return { end: i + 1, terminated: true };
    }
    if (text[i] === ESC && text[i + 1] === "\\") {
      return { end: i + 2, terminated: true };
    }
  }
  return { end: text.length, terminated: false };
}

function csiEnd(text: string, start: number): number {
  for (let i = start; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0x40 && code <= 0x7e) return i + 1;
    if (code < 0x20 || code > 0x3f) return i;
  }
  return text.length;
}

function escapeSequenceEnd(text: string, start: number): number {
  let i = start;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code >= 0x30 && code <= 0x7e) return i + 1;
    if (code < 0x20 || code > 0x2f) return Math.max(start, i);
    i += 1;
  }
  return text.length;
}

const SAFE_SGR_CODES = new Set([
  0, 1, 2, 3, 4, 9, 21, 22, 23, 24, 29, 30, 31, 32, 33, 34, 35, 36, 37, 39, 49,
  53, 55, 59, 90, 91, 92, 93, 94, 95, 96, 97,
]);

function extendedColorEnd(parameters: string[], start: number): number {
  const mode = parameters[start + 1];
  if (mode === "5") return Math.min(parameters.length, start + 3);
  if (mode === "2") return Math.min(parameters.length, start + 5);
  return Math.min(parameters.length, start + 2);
}

function sanitizeSgr(sequence: string, preserveBackgrounds: boolean): string {
  if (preserveBackgrounds) return sequence;

  const body = sequence.slice(2, -1);
  const parameters = body === "" ? ["0"] : body.split(";");
  const safe: string[] = [];

  for (let i = 0; i < parameters.length;) {
    const parameter = parameters[i];
    const colonCode = Number.parseInt(parameter.split(":", 1)[0] ?? "", 10);

    if (parameter.includes(":")) {
      if (colonCode === 38 || colonCode === 58) safe.push(parameter);
      i += 1;
      continue;
    }

    const code = Number.parseInt(parameter, 10);
    if (code === 38 || code === 48 || code === 58) {
      const end = extendedColorEnd(parameters, i);
      if (code !== 48) safe.push(...parameters.slice(i, end));
      i = end;
      continue;
    }

    if (SAFE_SGR_CODES.has(code)) safe.push(parameter);
    i += 1;
  }

  return safe.length > 0 ? `${ESC}[${safe.join(";")}m` : "";
}

function sanitizeTerminalText(
  text: string,
  preserveLineFeeds: boolean,
  preserveBackgrounds = true,
): string {
  if (!text.includes(ESC) && !/[\x00-\x1f\x7f-\x9f]/.test(text)) {
    return text;
  }

  let safe = "";
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);

    if (text[i] === ESC) {
      const kind = text[i + 1];

      if (kind === "[") {
        const end = csiEnd(text, i + 2);
        if (end > i + 2 && text[end - 1] === "m") {
          safe += sanitizeSgr(text.slice(i, end), preserveBackgrounds);
        }
        i = Math.max(i + 2, end);
        continue;
      }

      if (kind === "]") {
        const sequence = stringSequenceEnd(text, i + 2);
        if (text.startsWith("8;", i + 2) && sequence.terminated) {
          safe += text.slice(i, sequence.end);
        }
        i = sequence.end;
        continue;
      }

      if (kind === "P" || kind === "X" || kind === "^" || kind === "_") {
        i = stringSequenceEnd(text, i + 2).end;
        continue;
      }

      i = escapeSequenceEnd(text, i + 1);
      continue;
    }

    // Handle 8-bit forms of CSI and terminal strings. Do not preserve them:
    // UTF-8 terminals do not consistently interpret C1 styling controls.
    if (code === 0x9b) {
      i = csiEnd(text, i + 1);
      continue;
    }
    if (
      code === 0x90 ||
      code === 0x98 ||
      code === 0x9d ||
      code === 0x9e ||
      code === 0x9f
    ) {
      i = stringSequenceEnd(text, i + 1).end;
      continue;
    }

    if (code === 0x0a && preserveLineFeeds) {
      safe += text[i];
      i += 1;
      continue;
    }

    // Rendered lines must not contain carriage returns, backspaces, tabs,
    // DEL, or other C0/C1 terminal controls.
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      i += 1;
      continue;
    }

    safe += text[i];
    i += 1;
  }

  return safe;
}

/** Preserve display styles and hyperlinks, but remove terminal-state controls. */
export function sanitizeTerminalLine(line: string): string {
  return sanitizeTerminalText(line, false);
}

/** Remove terminal controls and background paint from untrusted tool text. */
export function sanitizeToolOutput(text: string): string {
  return sanitizeTerminalText(text, true, false);
}

function sanitizeToolResult(result: ToolResult): ToolResult {
  let changed = false;
  const content = result.content.map((block) => {
    if (block.type !== "text" || block.text === undefined) return block;

    const text = sanitizeToolOutput(block.text);
    if (text === block.text) return block;
    changed = true;
    return { ...block, text };
  });
  return changed ? { ...result, content } : result;
}

function installTextRendererPatch(
  prototype: TextRenderer,
  marker: symbol,
): void {
  const patchable = prototype as TextRenderer &
    Record<symbol, RenderPatchState | undefined>;
  if (patchable[marker]) return;

  const originalRender = patchable.render;
  if (typeof originalRender !== "function") {
    throw new Error("Text renderer unavailable");
  }

  const state: RenderPatchState = { originalRender };
  patchable[marker] = state;
  patchable.render = function patchedRender(
    this: TextRenderer,
    width: number,
  ): string[] {
    this.text = sanitizeTerminalText(this.text, true);
    return state.originalRender.call(this, width);
  };
}

function installToolResultPatch(): void {
  const prototype =
    ToolExecutionComponent.prototype as unknown as ToolResultRenderer &
      Record<symbol, ToolResultPatchState | undefined>;
  if (prototype[TOOL_RESULT_PATCH_STATE]) return;

  const originalUpdateResult = prototype.updateResult;
  if (typeof originalUpdateResult !== "function") {
    throw new Error("ToolExecutionComponent.updateResult unavailable");
  }

  const state: ToolResultPatchState = { originalUpdateResult };
  prototype[TOOL_RESULT_PATCH_STATE] = state;
  prototype.updateResult = function patchedUpdateResult(
    this: ToolResultRenderer,
    result: ToolResult,
    isPartial?: boolean,
  ): void {
    state.originalUpdateResult.call(
      this,
      sanitizeToolResult(result),
      isPartial,
    );
  };
}

function installTuiPatch(): void {
  // v0.84 split the concrete TUI into regular and fullscreen renderers. Their
  // shared implementation is the prototype above TuiMainScreen.
  const prototype = Object.getPrototypeOf(
    TuiMainScreen.prototype,
  ) as TuiPrototype;
  if (prototype[TUI_PATCH_STATE]) return;

  const originalApplyLineResets = prototype.applyLineResets;
  if (typeof originalApplyLineResets !== "function") {
    throw new Error("TUI.applyLineResets unavailable");
  }

  const state: TuiPatchState = { originalApplyLineResets };
  prototype[TUI_PATCH_STATE] = state;
  prototype.applyLineResets = function patchedApplyLineResets(
    lines: string[],
  ): string[] {
    const width = Math.max(1, this.terminal.columns);
    const safeLines = lines.map((line) => {
      if (isImageLine(line)) return line;

      const safeLine = sanitizeTerminalLine(line);
      return visibleWidth(safeLine) > width
        ? truncateToWidth(safeLine, width)
        : safeLine;
    });
    return state.originalApplyLineResets.call(this, safeLines);
  };
}

function installPatches(): void {
  installTextRendererPatch(
    Text.prototype as unknown as TextRenderer,
    TEXT_PATCH_STATE,
  );
  installTextRendererPatch(
    Markdown.prototype as unknown as TextRenderer,
    MARKDOWN_PATCH_STATE,
  );
  installToolResultPatch();
  installTuiPatch();
}

export default function safeTerminalOutput(pi: ExtensionAPI): void {
  pi.on("tool_result", (event) => {
    let changed = false;
    const content = event.content.map((block) => {
      if (block.type !== "text") return block;

      const text = sanitizeToolOutput(block.text);
      if (text === block.text) return block;
      changed = true;
      return { ...block, text };
    });
    return changed ? { content } : undefined;
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode === "tui") installPatches();
  });
}
