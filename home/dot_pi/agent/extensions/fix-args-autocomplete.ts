/**
 * Continues slash-command autocomplete into argument autocomplete after Tab
 * accepts a command and inserts its trailing space.
 */

import { Editor } from "@earendil-works/pi-tui";

const PATCH_STATE = Symbol.for("fix-args-autocomplete.patch");
const PREVIOUS_PATCH_STATE = Symbol.for(
  "slash-command-argument-autocomplete.patch",
);
const LEGACY_PATCH_STATE = Symbol.for("skill-autocomplete.patch");

function isSlashCommandAwaitingArgument(editor: any) {
  const line = editor.state?.lines?.[editor.state?.cursorLine ?? 0] ?? "";
  const cursorCol = editor.state?.cursorCol ?? 0;
  return /^\/[A-Za-z0-9:_-]+\s+$/.test(line.slice(0, cursorCol));
}

function patchEditor() {
  const prototype = Editor.prototype as any;
  if (prototype[PATCH_STATE]) return;

  // Keep an already-loaded pre-extraction patch active until Pi restarts.
  if (
    prototype[PREVIOUS_PATCH_STATE]?.originalHandleInput ||
    prototype[LEGACY_PATCH_STATE]?.originalHandleInput
  ) {
    return;
  }

  const originalHandleInput = prototype.handleInput;
  if (typeof originalHandleInput !== "function") {
    throw new Error("Editor.handleInput not found");
  }

  prototype[PATCH_STATE] = { originalHandleInput };
  prototype.handleInput = function patchedHandleInput(data: string) {
    const completedSlashCommand =
      data === "\t" &&
      this.autocompleteState &&
      typeof this.autocompletePrefix === "string" &&
      this.autocompletePrefix.startsWith("/");

    originalHandleInput.call(this, data);

    if (
      completedSlashCommand &&
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
