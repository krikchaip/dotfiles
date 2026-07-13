/**
 * Make slash-command argument autocomplete behave as one editing loop.
 *
 * Pi completes a slash command and its arguments in separate autocomplete
 * passes. This patch bridges those passes: accepting `/command` with Tab opens
 * its argument picker, accepting a non-terminal argument opens its successor,
 * and an exact terminal argument stays closed while its text remains intact.
 *
 * Pi refreshes autocomplete for character deletion, but not word or line
 * deletion. The input wrapper refreshes those missing edit paths so a picker
 * never applies a completion calculated from stale editor text.
 *
 * The extension owns two `Editor` wrappers. Reloads recover each wrapper's
 * recorded original method, including legacy patch symbols, instead of nesting
 * wrappers on every `/reload`.
 */

import { Editor, getKeybindings, matchesKey } from "@earendil-works/pi-tui";

const PATCH_STATE = Symbol.for("fix-args-autocomplete.patch");
const PREVIOUS_PATCH_STATE = Symbol.for(
  "slash-command-argument-autocomplete.patch",
);
const LEGACY_PATCH_STATE = Symbol.for("skill-autocomplete.patch");
const TERMINAL_ARGUMENT_STATE = Symbol.for(
  "fix-args-autocomplete.terminal-argument",
);
const BULK_DELETE_ACTIONS = [
  "tui.editor.deleteToLineEnd",
  "tui.editor.deleteToLineStart",
  "tui.editor.deleteWordBackward",
  "tui.editor.deleteWordForward",
] as const;

type EditorInstance = any;
type Suggestion = { value?: unknown };
type Suggestions = { items?: Suggestion[] };
type InputHandler = (data: string) => unknown;
type ApplySuggestions = (suggestions: Suggestions, state: unknown) => unknown;

type PatchState = {
  originalHandleInput: InputHandler;
  originalApplyAutocompleteSuggestions?: ApplySuggestions;
};

type TerminalArgumentState = {
  cursorLine: number;
  text: string;
};

function cursorPosition(editor: EditorInstance) {
  return {
    line: editor.state?.cursorLine ?? 0,
    column: editor.state?.cursorCol ?? 0,
  };
}

function currentLine(editor: EditorInstance) {
  const { line } = cursorPosition(editor);
  return editor.state?.lines?.[line] ?? "";
}

function textBeforeCursor(editor: EditorInstance) {
  const { column } = cursorPosition(editor);
  return currentLine(editor).slice(0, column);
}

function slashArguments(text: string) {
  return text.match(/^\/\S+\s+(.*)$/)?.[1]?.trimEnd();
}

function isSlashArgumentCompletion(editor: EditorInstance) {
  return (
    typeof editor.autocompletePrefix === "string" &&
    !editor.autocompletePrefix.startsWith("/") &&
    /^\/\S+\s/.test(textBeforeCursor(editor))
  );
}

function isSlashCommandAwaitingArgument(editor: EditorInstance) {
  return /^\/\S+(?:\s+\S+)*\s+$/.test(textBeforeCursor(editor));
}

function appendArgumentDelimiter(editor: EditorInstance) {
  const { line: cursorLine, column: cursorCol } = cursorPosition(editor);
  const line = currentLine(editor);
  if (/\s$/.test(line.slice(0, cursorCol))) return;

  editor.state.lines[cursorLine] =
    line.slice(0, cursorCol) + " " + line.slice(cursorCol);
  if (typeof editor.setCursorCol === "function") {
    editor.setCursorCol(cursorCol + 1);
  } else {
    editor.state.cursorCol = cursorCol + 1;
  }
  editor.onChange?.(editor.getText());
}

function refreshAutocompleteAfterDeletion(editor: EditorInstance) {
  if (
    editor.autocompleteState &&
    typeof editor.updateAutocomplete === "function"
  ) {
    editor.updateAutocomplete();
    return;
  }

  if (
    typeof editor.isInSlashCommandContext === "function" &&
    editor.isInSlashCommandContext(textBeforeCursor(editor)) &&
    typeof editor.tryTriggerAutocomplete === "function"
  ) {
    editor.tryTriggerAutocomplete();
  }
}

function rememberTerminalArgument(editor: EditorInstance) {
  const { line: cursorLine } = cursorPosition(editor);
  const argumentMatch = currentLine(editor).match(/^(\/\S+\s+)(.+?)\s*$/);
  if (!argumentMatch) return;

  editor[TERMINAL_ARGUMENT_STATE] = {
    cursorLine,
    text: `${argumentMatch[1]}${argumentMatch[2]}`,
  } satisfies TerminalArgumentState;
}

function clearTerminalArgument(editor: EditorInstance) {
  delete editor[TERMINAL_ARGUMENT_STATE];
}

function hasRememberedTerminalArgument(editor: EditorInstance) {
  const terminal = editor[TERMINAL_ARGUMENT_STATE] as
    | TerminalArgumentState
    | undefined;
  if (!terminal) return false;

  const { line: cursorLine } = cursorPosition(editor);
  const line = currentLine(editor);
  const unchanged =
    cursorLine === terminal.cursorLine &&
    (line === terminal.text ||
      (line.startsWith(terminal.text) &&
        /^\s/.test(line.slice(terminal.text.length))));
  if (unchanged) return true;

  clearTerminalArgument(editor);
  return false;
}

function isOpeningArgumentContinuation(editor: EditorInstance) {
  const terminal = editor[TERMINAL_ARGUMENT_STATE] as
    | TerminalArgumentState
    | undefined;
  if (!terminal) return false;

  const { line: cursorLine } = cursorPosition(editor);
  return (
    cursorLine === terminal.cursorLine &&
    currentLine(editor) === terminal.text &&
    textBeforeCursor(editor) === terminal.text
  );
}

function hasTerminalExactSuggestion(
  editor: EditorInstance,
  suggestions: Suggestions,
) {
  const completedArguments = slashArguments(currentLine(editor));
  return (
    Boolean(completedArguments) &&
    suggestions?.items?.some(
      (item) =>
        typeof item.value === "string" &&
        item.value.trimEnd() === completedArguments,
    )
  );
}

async function triggerArgumentContinuation(editor: EditorInstance) {
  const provider = editor.autocompleteProvider;
  if (
    typeof provider?.getSuggestions !== "function" ||
    typeof editor.applyAutocompleteSuggestions !== "function"
  ) {
    return;
  }

  const { line: cursorLine, column: cursorCol } = cursorPosition(editor);
  const lines = [...(editor.state?.lines ?? [])];
  const snapshot = editor.getText();
  const completedArguments = slashArguments(textBeforeCursor(editor));
  if (!completedArguments) return;

  let suggestions: Suggestions | undefined;
  try {
    suggestions = await provider.getSuggestions(lines, cursorLine, cursorCol, {
      signal: new AbortController().signal,
    });
  } catch {
    return;
  }

  if (
    editor.getText() !== snapshot ||
    editor.state?.cursorLine !== cursorLine ||
    editor.state?.cursorCol !== cursorCol ||
    editor.autocompleteState
  ) {
    return;
  }

  const continuationPrefix = `${completedArguments} `;
  const continuationItems = suggestions?.items?.filter(
    (item) =>
      typeof item.value === "string" &&
      item.value.startsWith(continuationPrefix),
  );
  if (!continuationItems?.length) {
    rememberTerminalArgument(editor);
    return;
  }

  clearTerminalArgument(editor);
  editor.applyAutocompleteSuggestions(
    { ...suggestions, items: continuationItems },
    "regular",
  );
  editor.tui?.requestRender?.();
}

function originalMethods(prototype: EditorInstance) {
  const priorState = [
    prototype[PATCH_STATE],
    prototype[PREVIOUS_PATCH_STATE],
    prototype[LEGACY_PATCH_STATE],
  ].find(
    (state): state is PatchState =>
      typeof state?.originalHandleInput === "function",
  );
  return {
    handleInput: priorState?.originalHandleInput ?? prototype.handleInput,
    applySuggestions:
      priorState?.originalApplyAutocompleteSuggestions ??
      prototype.applyAutocompleteSuggestions,
  };
}

function patchEditor() {
  const prototype = Editor.prototype as EditorInstance;
  const {
    handleInput: originalHandleInput,
    applySuggestions: originalApplyAutocompleteSuggestions,
  } = originalMethods(prototype);
  if (typeof originalHandleInput !== "function") {
    throw new Error("Editor.handleInput not found");
  }
  if (typeof originalApplyAutocompleteSuggestions !== "function") {
    throw new Error("Editor.applyAutocompleteSuggestions not found");
  }

  // Reassign on reload so current extension source always owns this patch.
  prototype[PATCH_STATE] = {
    originalHandleInput,
    originalApplyAutocompleteSuggestions,
  } satisfies PatchState;
  prototype.applyAutocompleteSuggestions = function patchedApplySuggestions(
    suggestions: Suggestions,
    state: unknown,
  ) {
    if (hasRememberedTerminalArgument(this)) {
      this.cancelAutocomplete();
      return;
    }
    if (hasTerminalExactSuggestion(this, suggestions)) {
      rememberTerminalArgument(this);
      this.cancelAutocomplete();
      return;
    }
    return originalApplyAutocompleteSuggestions.call(this, suggestions, state);
  };
  prototype.handleInput = function patchedHandleInput(data: string) {
    const keybindings = getKeybindings();
    const completedAutocomplete =
      keybindings.matches(data, "tui.input.tab") &&
      Boolean(this.autocompleteState);
    const bulkDeletion = BULK_DELETE_ACTIONS.some((action) =>
      keybindings.matches(data, action),
    );
    const completedArgument =
      completedAutocomplete && isSlashArgumentCompletion(this);
    const typedArgumentDelimiter =
      (matchesKey(data, "space") || matchesKey(data, "shift+space")) &&
      /^\/\S+\s+.*\S$/.test(textBeforeCursor(this));
    if (typedArgumentDelimiter && isOpeningArgumentContinuation(this)) {
      clearTerminalArgument(this);
    }

    originalHandleInput.call(this, data);

    if (bulkDeletion) {
      refreshAutocompleteAfterDeletion(this);
      return;
    }
    if (completedArgument && !this.autocompleteState) {
      appendArgumentDelimiter(this);
      void triggerArgumentContinuation(this);
      return;
    }
    if (
      typedArgumentDelimiter &&
      !this.autocompleteState &&
      isSlashCommandAwaitingArgument(this)
    ) {
      void triggerArgumentContinuation(this);
      return;
    }
    if (
      completedAutocomplete &&
      !this.autocompleteState &&
      isSlashCommandAwaitingArgument(this) &&
      typeof this.tryTriggerAutocomplete === "function"
    ) {
      this.tryTriggerAutocomplete();
    }
  };
}

export default function () {
  try {
    patchEditor();
  } catch (error) {
    console.error("fix-args-autocomplete: failed to patch editor", error);
  }
}
