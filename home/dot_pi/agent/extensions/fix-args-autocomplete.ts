/**
 * Keep one autocomplete list visible across slash-command argument steps.
 *
 * Tab applies the selected command or argument without closing Pi's current
 * `SelectList`. While successor suggestions load, stale selections cannot be
 * accepted. The result then replaces the same list instance's items, layout,
 * selection, and prefix. Terminal choices close the list once.
 *
 * Pi does not expose this lifecycle publicly. This extension therefore owns
 * private `Editor` and `SelectList` fields, aborts pending work on edits or
 * reload, and restores the methods that existed before this patch.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Editor, getKeybindings, matchesKey } from "@earendil-works/pi-tui";

const PATCH_STATE = Symbol.for("fix-args-autocomplete.patch");
const POC_PATCH_STATE = Symbol.for("fix-args-autocomplete-reuse-poc.patch");
const PREVIOUS_PATCH_STATE = Symbol.for(
  "slash-command-argument-autocomplete.patch",
);
const LEGACY_PATCH_STATE = Symbol.for("skill-autocomplete.patch");
const TERMINAL_ARGUMENT_STATE = Symbol.for(
  "fix-args-autocomplete.terminal-argument",
);
const CONTINUATION_STATE = Symbol.for("fix-args-autocomplete.continuation");
const ARGUMENT_LIST_LAYOUT = {};
const SLASH_COMMAND_LIST_LAYOUT = {
  minPrimaryColumnWidth: 12,
  maxPrimaryColumnWidth: 32,
};
const BULK_DELETE_ACTIONS = [
  "tui.editor.deleteToLineEnd",
  "tui.editor.deleteToLineStart",
  "tui.editor.deleteWordBackward",
  "tui.editor.deleteWordForward",
] as const;

type EditorInstance = any;
type Suggestion = { value?: unknown };
type Suggestions = { items?: Suggestion[]; prefix?: unknown };
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

type ContinuationState = {
  controller: AbortController;
  token: number;
};

let nextContinuationToken = 0;
const ACTIVE_CONTINUATION_EDITORS = new Set<EditorInstance>();

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

function appendArgumentDelimiter(editor: EditorInstance, notifyChange = true) {
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
  if (notifyChange) editor.onChange?.(editor.getText());
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
    TerminalArgumentState | undefined;
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
    TerminalArgumentState | undefined;
  if (!terminal) return false;

  const { line: cursorLine } = cursorPosition(editor);
  return (
    cursorLine === terminal.cursorLine &&
    currentLine(editor) === terminal.text &&
    textBeforeCursor(editor) === terminal.text
  );
}

function isCurrentSlashArgumentSuggestions(
  editor: EditorInstance,
  suggestions: Suggestions,
) {
  const currentArguments = slashArguments(textBeforeCursor(editor));
  return (
    Boolean(currentArguments) &&
    typeof suggestions.prefix === "string" &&
    suggestions.prefix.trimEnd() === currentArguments
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

function isSlashCommandCompletion(editor: EditorInstance) {
  return (
    typeof editor.autocompletePrefix === "string" &&
    editor.autocompletePrefix.startsWith("/") &&
    /^\/\S*$/.test(textBeforeCursor(editor))
  );
}

function cancelContinuation(editor: EditorInstance) {
  const state = editor[CONTINUATION_STATE] as ContinuationState | undefined;
  state?.controller.abort();
  delete editor[CONTINUATION_STATE];
  ACTIVE_CONTINUATION_EDITORS.delete(editor);
}

function acceptAutocompleteWithoutClosing(
  editor: EditorInstance,
  appendDelimiter: boolean,
) {
  const list = editor.autocompleteList;
  const provider = editor.autocompleteProvider;
  const selected = list?.getSelectedItem?.();
  if (!list || !selected || typeof provider?.applyCompletion !== "function") {
    return;
  }

  editor.cancelAutocompleteRequest?.();
  editor.pushUndoSnapshot?.();
  editor.lastAction = null;
  const result = provider.applyCompletion(
    editor.state.lines,
    editor.state.cursorLine,
    editor.state.cursorCol,
    selected,
    editor.autocompletePrefix,
  );
  editor.state.lines = result.lines;
  editor.state.cursorLine = result.cursorLine;
  if (typeof editor.setCursorCol === "function") {
    editor.setCursorCol(result.cursorCol);
  } else {
    editor.state.cursorCol = result.cursorCol;
  }
  if (appendDelimiter) appendArgumentDelimiter(editor, false);
  editor.onChange?.(editor.getText());
  return list;
}

function replaceAutocompleteItems(
  editor: EditorInstance,
  list: EditorInstance,
  suggestions: Suggestions,
  items: Suggestion[],
) {
  const prefix =
    typeof suggestions.prefix === "string" ? suggestions.prefix : "";
  list.items = items;
  list.filteredItems = items;
  list.selectedIndex = 0;
  list.layout = prefix.startsWith("/")
    ? SLASH_COMMAND_LIST_LAYOUT
    : ARGUMENT_LIST_LAYOUT;

  const bestMatchIndex = editor.getBestAutocompleteMatchIndex?.(items, prefix);
  if (typeof bestMatchIndex === "number" && bestMatchIndex >= 0) {
    list.setSelectedIndex?.(bestMatchIndex);
  }
  editor.autocompletePrefix = prefix;
  editor.autocompleteList = list;
  editor.autocompleteState = "regular";
}

async function reuseListForContinuation(
  editor: EditorInstance,
  list: EditorInstance,
  completedArgument: boolean,
) {
  const provider = editor.autocompleteProvider;
  if (typeof provider?.getSuggestions !== "function") return;

  cancelContinuation(editor);
  const controller = new AbortController();
  const state = {
    controller,
    token: ++nextContinuationToken,
  } satisfies ContinuationState;
  editor[CONTINUATION_STATE] = state;
  ACTIVE_CONTINUATION_EDITORS.add(editor);

  const { line: cursorLine, column: cursorCol } = cursorPosition(editor);
  const lines = [...(editor.state?.lines ?? [])];
  const snapshot = editor.getText();
  const completedArguments = slashArguments(textBeforeCursor(editor));

  let suggestions: Suggestions | undefined;
  let providerFailed = false;
  try {
    suggestions = await provider.getSuggestions(lines, cursorLine, cursorCol, {
      signal: controller.signal,
    });
  } catch {
    providerFailed = !controller.signal.aborted;
  }

  const currentState = editor[CONTINUATION_STATE] as
    ContinuationState | undefined;
  if (currentState?.token !== state.token) return;

  delete editor[CONTINUATION_STATE];
  ACTIVE_CONTINUATION_EDITORS.delete(editor);
  if (controller.signal.aborted) return;

  const continuationIsStale =
    editor.getText() !== snapshot ||
    editor.state?.cursorLine !== cursorLine ||
    editor.state?.cursorCol !== cursorCol ||
    editor.autocompleteList !== list;
  if (providerFailed || continuationIsStale) {
    if (editor.autocompleteList === list) {
      editor.cancelAutocomplete?.();
      editor.tui?.requestRender?.();
    }
    return;
  }

  const continuationPrefix = completedArguments
    ? `${completedArguments} `
    : undefined;
  const continuationItems = suggestions?.items?.filter(
    (item) =>
      !completedArgument ||
      (typeof item.value === "string" &&
        typeof continuationPrefix === "string" &&
        item.value.startsWith(continuationPrefix)),
  );
  if (!continuationItems?.length) {
    if (completedArgument) rememberTerminalArgument(editor);
    editor.cancelAutocomplete?.();
    editor.tui?.requestRender?.();
    return;
  }

  clearTerminalArgument(editor);
  replaceAutocompleteItems(editor, list, suggestions ?? {}, continuationItems);
  editor.tui?.requestRender?.();
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
    prototype[POC_PATCH_STATE],
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
  const previousHandleInput = prototype.handleInput;
  const previousApplyAutocompleteSuggestions =
    prototype.applyAutocompleteSuggestions;
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
  const patchState = {
    originalHandleInput,
    originalApplyAutocompleteSuggestions,
  } satisfies PatchState;
  prototype[PATCH_STATE] = patchState;
  const patchedApplyAutocompleteSuggestions = function patchedApplySuggestions(
    this: EditorInstance,
    suggestions: Suggestions,
    state: unknown,
  ) {
    if (hasRememberedTerminalArgument(this)) {
      if (isCurrentSlashArgumentSuggestions(this, suggestions)) {
        this.cancelAutocomplete();
        return;
      }
      clearTerminalArgument(this);
    }
    if (hasTerminalExactSuggestion(this, suggestions)) {
      rememberTerminalArgument(this);
      this.cancelAutocomplete();
      return;
    }
    return originalApplyAutocompleteSuggestions.call(this, suggestions, state);
  };
  const patchedHandleInput = function patchedHandleInput(
    this: EditorInstance,
    data: string,
  ) {
    const keybindings = getKeybindings();
    if (this[CONTINUATION_STATE]) {
      if (
        keybindings.matches(data, "tui.input.tab") ||
        keybindings.matches(data, "tui.select.confirm") ||
        keybindings.matches(data, "tui.select.up") ||
        keybindings.matches(data, "tui.select.down")
      ) {
        return;
      }
      cancelContinuation(this);
      this.cancelAutocomplete?.();
    }

    const completedAutocomplete =
      keybindings.matches(data, "tui.input.tab") &&
      Boolean(this.autocompleteState);
    const bulkDeletion = BULK_DELETE_ACTIONS.some((action) =>
      keybindings.matches(data, action),
    );
    const completedArgument =
      completedAutocomplete && isSlashArgumentCompletion(this);
    const completedCommand =
      completedAutocomplete && isSlashCommandCompletion(this);
    const typedArgumentDelimiter =
      (matchesKey(data, "space") || matchesKey(data, "shift+space")) &&
      /^\/\S+\s+.*\S$/.test(textBeforeCursor(this));
    if (typedArgumentDelimiter && isOpeningArgumentContinuation(this)) {
      clearTerminalArgument(this);
    }

    if (completedArgument || completedCommand) {
      const list = acceptAutocompleteWithoutClosing(this, completedArgument);
      if (list) {
        void reuseListForContinuation(this, list, completedArgument);
        return;
      }
    }

    originalHandleInput.call(this, data);

    if (bulkDeletion) {
      refreshAutocompleteAfterDeletion(this);
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

  prototype.applyAutocompleteSuggestions = patchedApplyAutocompleteSuggestions;
  prototype.handleInput = patchedHandleInput;

  return () => {
    for (const editor of ACTIVE_CONTINUATION_EDITORS) {
      cancelContinuation(editor);
      editor.cancelAutocomplete?.();
      editor.tui?.requestRender?.();
    }
    if (prototype.handleInput === patchedHandleInput) {
      prototype.handleInput = previousHandleInput;
    }
    if (
      prototype.applyAutocompleteSuggestions ===
      patchedApplyAutocompleteSuggestions
    ) {
      prototype.applyAutocompleteSuggestions =
        previousApplyAutocompleteSuggestions;
    }
    if (prototype[PATCH_STATE] === patchState) delete prototype[PATCH_STATE];
  };
}

export default function (pi: ExtensionAPI) {
  let cleanup: (() => void) | undefined;
  try {
    cleanup = patchEditor();
  } catch (error) {
    console.error("fix-args-autocomplete: failed to patch editor", error);
  }
  pi.on("session_shutdown", () => cleanup?.());
}
