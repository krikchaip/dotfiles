/**
 * Highlight slash commands and inline skill references in the editor/history.
 */

import {
  CustomEditor,
  UserMessageComponent,
  type ExtensionAPI,
  type ThemeColor,
} from "@earendil-works/pi-coding-agent";

const EDITOR_PATCH_STATE = Symbol.for("slash-highlight.editor-render.patch");
const USER_MESSAGE_PATCH_STATE = Symbol.for(
  "slash-highlight.user-message-render.patch",
);

const BUILTIN_COMMANDS = [
  "settings",
  "model",
  "scoped-models",
  "export",
  "import",
  "share",
  "copy",
  "name",
  "session",
  "changelog",
  "hotkeys",
  "fork",
  "clone",
  "tree",
  "trust",
  "login",
  "logout",
  "new",
  "compact",
  "resume",
  "reload",
  "quit",
];

// Try: "accent", "mdLink", "syntaxKeyword", "syntaxFunction", "toolTitle".
const HIGHLIGHT_COLOR: ThemeColor = "accent";

const COMMAND_TOKEN_PATTERN = /^\/([A-Za-z0-9:_-]*)/;
const EDITOR_SKILL_TOKEN_PATTERN = /(^|[^\w/-])(\/(?:skill:)?([A-Za-z0-9-]*))/g;
const HISTORY_SKILL_TOKEN_PATTERN =
  /(^|[^\w/-])(\/(?:skill:)?([A-Za-z0-9-]+))(?=$|[^A-Za-z0-9-])/g;

type EditorHighlightState = {
  originalRender: (width: number) => string[];
  getCommandNames: () => Set<string>;
  getSkillNames: () => Set<string>;
  color: (text: string) => string;
};

type UserMessageHighlightState = {
  originalRender: (width: number) => string[];
  getSkillNames: () => Set<string>;
  color: (text: string) => string;
};

function escapeEnd(text: string, start: number) {
  if (text[start] !== "\x1b") return start;

  const kind = text[start + 1];
  if (kind === "[") {
    for (let i = start + 2; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code >= 0x40 && code <= 0x7e) return i + 1;
    }
    return text.length;
  }

  if (kind === "]" || kind === "_") {
    const bel = text.indexOf("\x07", start + 2);
    const st = text.indexOf("\x1b\\", start + 2);
    if (bel === -1) return st === -1 ? text.length : st + 2;
    if (st === -1) return bel + 1;
    return Math.min(bel + 1, st + 2);
  }

  return Math.min(start + 2, text.length);
}

function visibleText(text: string) {
  let visible = "";

  for (let i = 0; i < text.length; ) {
    if (text[i] === "\x1b") {
      i = escapeEnd(text, i);
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

function sgrCodes(sequence: string) {
  if (!sequence.startsWith("\x1b[") || !sequence.endsWith("m")) return [];

  const body = sequence.slice(2, -1);
  if (body === "") return [0];

  return body
    .split(";")
    .map((part) => Number(part || "0"))
    .filter((code) => Number.isFinite(code));
}

function nextInverseState(sequence: string, inverse: boolean) {
  let next = inverse;

  for (const code of sgrCodes(sequence)) {
    if (code === 0 || code === 27) next = false;
    if (code === 7) next = true;
  }

  return next;
}

function foregroundSequence(codes: number[]) {
  return `\x1b[${codes.join(";")}m`;
}

function nextForegroundState(sequence: string, foreground: string) {
  const codes = sgrCodes(sequence);
  let next = foreground;

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];

    if (code === 0 || code === 39) {
      next = "";
      continue;
    }

    if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
      next = foregroundSequence([code]);
      continue;
    }

    if (code !== 38) continue;

    const mode = codes[i + 1];
    if (mode === 5 && codes[i + 2] !== undefined) {
      next = foregroundSequence([38, 5, codes[i + 2]]);
      i += 2;
      continue;
    }

    if (
      mode === 2 &&
      codes[i + 2] !== undefined &&
      codes[i + 3] !== undefined &&
      codes[i + 4] !== undefined
    ) {
      next = foregroundSequence([
        38,
        2,
        codes[i + 2],
        codes[i + 3],
        codes[i + 4],
      ]);
      i += 4;
    }
  }

  return next;
}

function highlightVisibleRanges(
  text: string,
  ranges: Array<{ start: number; end: number }>,
  color: (text: string) => string,
) {
  if (ranges.length === 0) return text;

  const highlightedPositions = new Set<number>();
  for (const range of ranges) {
    for (let i = range.start; i < range.end; i++) highlightedPositions.add(i);
  }

  let result = "";
  let visibleIndex = 0;
  let inverse = false;
  let foreground = "";

  for (let i = 0; i < text.length; ) {
    if (text[i] === "\x1b") {
      const end = escapeEnd(text, i);
      const sequence = text.slice(i, end);
      result += sequence;
      inverse = nextInverseState(sequence, inverse);
      foreground = nextForegroundState(sequence, foreground);
      i = end;
      continue;
    }

    const codePoint = text.codePointAt(i);
    if (codePoint === undefined) break;
    const char = String.fromCodePoint(codePoint);
    result +=
      highlightedPositions.has(visibleIndex) && !inverse
        ? color(char) + foreground
        : char;
    visibleIndex++;
    i += char.length;
  }

  return result;
}

function commandNames(pi: ExtensionAPI) {
  const dynamic = pi
    .getCommands()
    .filter((command) => command.source !== "skill")
    .map((command) => command.name);

  return new Set([...BUILTIN_COMMANDS, ...dynamic]);
}

function skillNames(pi: ExtensionAPI) {
  return new Set(
    pi
      .getCommands()
      .filter((command) => command.source === "skill")
      .map((command) =>
        command.name.startsWith("skill:")
          ? command.name.slice("skill:".length)
          : command.name,
      ),
  );
}

function hasMatchingPrefix(prefix: string, names: Set<string>) {
  if (prefix === "") return false;
  for (const name of names) {
    if (name.startsWith(prefix)) return true;
  }
  return false;
}

function editorCommandToken(text: string, names: Set<string>) {
  const match = text.match(COMMAND_TOKEN_PATTERN);
  if (!match) return undefined;

  const token = match[0];
  const prefix = match[1] ?? "";
  return hasMatchingPrefix(prefix, names) ? token : undefined;
}

function skillTokenRanges(
  text: string,
  names: Set<string>,
  allowPrefix: boolean,
) {
  const ranges: Array<{ start: number; end: number }> = [];
  const pattern = allowPrefix
    ? EDITOR_SKILL_TOKEN_PATTERN
    : HISTORY_SKILL_TOKEN_PATTERN;

  for (const match of text.matchAll(pattern)) {
    const token = match[2];
    const name = match[3] ?? "";
    const matches = allowPrefix
      ? hasMatchingPrefix(name, names)
      : names.has(name);
    if (!token || !matches || match.index === undefined) continue;

    const start = match.index + (match[1]?.length ?? 0);
    ranges.push({ start, end: start + token.length });
  }

  return ranges;
}

function highlightEditorLine(
  line: string,
  commandToken: string | undefined,
  skillNames: Set<string>,
  color: (text: string) => string,
  state: { commandDone: boolean },
) {
  const visible = visibleText(line);
  const ranges = skillTokenRanges(visible, skillNames, true);

  if (commandToken && !state.commandDone) {
    const index = visible.indexOf(commandToken);
    if (index >= 0) {
      ranges.push({ start: index, end: index + commandToken.length });
      state.commandDone = true;
    }
  }

  return highlightVisibleRanges(line, ranges, color);
}

function patchEditorRender(
  getCommandNames: () => Set<string>,
  getSkillNames: () => Set<string>,
  color: (text: string) => string,
) {
  const prototype = CustomEditor.prototype as any;
  const state = prototype[EDITOR_PATCH_STATE] as
    | EditorHighlightState
    | undefined;

  if (state) {
    state.getCommandNames = getCommandNames;
    state.getSkillNames = getSkillNames;
    state.color = color;
    return;
  }

  const originalRender = prototype.render;
  if (typeof originalRender !== "function") {
    throw new Error("CustomEditor.render not found");
  }

  const nextState: EditorHighlightState = {
    originalRender,
    getCommandNames,
    getSkillNames,
    color,
  };
  prototype[EDITOR_PATCH_STATE] = nextState;

  prototype.render = function patchedRender(width: number) {
    const lines = nextState.originalRender.call(this, width) as string[];
    const text = typeof this.getText === "function" ? this.getText() : "";
    const commandToken = editorCommandToken(text, nextState.getCommandNames());
    const names = nextState.getSkillNames();

    if (!commandToken && names.size === 0) return lines;

    const renderState = { commandDone: false };
    return lines.map((line) =>
      highlightEditorLine(
        line,
        commandToken,
        names,
        nextState.color,
        renderState,
      ),
    );
  };
}

function patchUserMessageRender(
  getSkillNames: () => Set<string>,
  color: (text: string) => string,
) {
  const prototype = UserMessageComponent.prototype as any;
  const state = prototype[USER_MESSAGE_PATCH_STATE] as
    | UserMessageHighlightState
    | undefined;

  if (state) {
    state.getSkillNames = getSkillNames;
    state.color = color;
    return;
  }

  const originalRender = prototype.render;
  if (typeof originalRender !== "function") {
    throw new Error("UserMessageComponent.render not found");
  }

  const nextState: UserMessageHighlightState = {
    originalRender,
    getSkillNames,
    color,
  };
  prototype[USER_MESSAGE_PATCH_STATE] = nextState;

  prototype.render = function patchedRender(width: number) {
    const lines = nextState.originalRender.call(this, width) as string[];
    const names = nextState.getSkillNames();
    if (names.size === 0) return lines;

    return lines.map((line) =>
      highlightVisibleRanges(
        line,
        skillTokenRanges(visibleText(line), names, false),
        nextState.color,
      ),
    );
  };
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    const color = (text: string) => ctx.ui.theme.fg(HIGHLIGHT_COLOR, text);

    try {
      patchEditorRender(
        () => commandNames(pi),
        () => skillNames(pi),
        color,
      );
    } catch (error) {
      console.error("slash-highlight: failed to patch editor", error);
    }

    try {
      patchUserMessageRender(() => skillNames(pi), color);
    } catch (error) {
      console.error("slash-highlight: failed to patch user messages", error);
    }
  });
}
