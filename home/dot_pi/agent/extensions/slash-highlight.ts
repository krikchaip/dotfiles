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
const EDITOR_SKILL_TOKEN_PATTERN = /\/skill:([A-Za-z0-9-]*)/g;
const HISTORY_SKILL_TOKEN_PATTERN =
  /\/skill:([A-Za-z0-9-]+)(?=$|[^A-Za-z0-9-])/g;

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

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceAll(text: string, token: string, replacement: string) {
  return text.replace(new RegExp(escapeRegExp(token), "g"), replacement);
}

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

  for (let i = 0; i < text.length; ) {
    if (text[i] === "\x1b") {
      const end = escapeEnd(text, i);
      const sequence = text.slice(i, end);
      result += sequence;
      inverse = nextInverseState(sequence, inverse);
      i = end;
      continue;
    }

    const codePoint = text.codePointAt(i);
    if (codePoint === undefined) break;
    const char = String.fromCodePoint(codePoint);
    result +=
      highlightedPositions.has(visibleIndex) && !inverse ? color(char) : char;
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
  if (prefix === "") return names.size > 0;
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

function editorSkillTokens(text: string, names: Set<string>) {
  const tokens = new Set<string>();

  for (const match of text.matchAll(EDITOR_SKILL_TOKEN_PATTERN)) {
    const token = match[0];
    const prefix = match[1] ?? "";
    if (hasMatchingPrefix(prefix, names)) tokens.add(token);
  }

  return [...tokens].sort((a, b) => b.length - a.length);
}

function historySkillTokens(line: string, names: Set<string>) {
  const tokens = new Set<string>();

  for (const match of line.matchAll(HISTORY_SKILL_TOKEN_PATTERN)) {
    const token = match[0];
    const name = match[1];
    if (name && names.has(name)) tokens.add(token);
  }

  return [...tokens].sort((a, b) => b.length - a.length);
}

function highlightEditorLine(
  line: string,
  commandToken: string | undefined,
  skillTokens: string[],
  color: (text: string) => string,
  state: { commandDone: boolean },
) {
  const visible = visibleText(line);
  const ranges: Array<{ start: number; end: number }> = [];

  if (commandToken && !state.commandDone) {
    const index = visible.indexOf(commandToken);
    if (index >= 0) {
      ranges.push({ start: index, end: index + commandToken.length });
      state.commandDone = true;
    }
  }

  for (const token of skillTokens) {
    for (let index = visible.indexOf(token); index >= 0; ) {
      ranges.push({ start: index, end: index + token.length });
      index = visible.indexOf(token, index + token.length);
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
    const skillTokens = editorSkillTokens(text, nextState.getSkillNames());

    if (!commandToken && skillTokens.length === 0) return lines;

    const renderState = { commandDone: false };
    return lines.map((line) =>
      highlightEditorLine(
        line,
        commandToken,
        skillTokens,
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

    return lines.map((line) => {
      let highlighted = line;
      for (const token of historySkillTokens(line, names)) {
        highlighted = replaceAll(highlighted, token, nextState.color(token));
      }
      return highlighted;
    });
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
