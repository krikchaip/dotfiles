/**
 * Image submit guards.
 *
 * Blocks image attachment submission when image reading is disabled or the
 * currently selected model does not advertise image input support.
 */

import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import type { ImageAttachmentsDrafts } from "./draft-attachments";

const SUBMIT_GUARD_PATCH_STATE = Symbol.for(
  "pi-image-attachments.submit-guard.patch",
);

let builtinCommandNames: Set<string> | undefined;
let builtinCommandNamesPromise: Promise<Set<string>> | undefined;

type SubmitGuardPatchState = {
  originalSetupEditorSubmitHandler: (...args: any[]) => any;
};

function slashCommandName(text: string): string | undefined {
  if (!text.startsWith("/")) return undefined;
  const spaceIndex = text.indexOf(" ");
  const commandName =
    spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
  return commandName || undefined;
}

async function loadBuiltinCommandNames(): Promise<Set<string>> {
  if (builtinCommandNames) return builtinCommandNames;

  builtinCommandNamesPromise ??= (async () => {
    try {
      const pkgUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
      const slashCommandsUrl = new URL("./core/slash-commands.js", pkgUrl).href;
      const module = (await import(slashCommandsUrl)) as any;
      builtinCommandNames = new Set(
        (module.BUILTIN_SLASH_COMMANDS ?? [])
          .map((command: any) => command?.name)
          .filter((name: any): name is string => typeof name === "string"),
      );
    } catch {
      builtinCommandNames = new Set();
    }

    return builtinCommandNames;
  })();

  return builtinCommandNamesPromise;
}

async function isKnownBuiltinOrExtensionCommand(
  mode: any,
  text: string,
): Promise<boolean> {
  const commandName = slashCommandName(text);
  if (!commandName) return false;
  if ((await loadBuiltinCommandNames()).has(commandName)) return true;
  return !!mode?.session?.extensionRunner?.getCommand?.(commandName);
}

function unresolvedImageWarning(ids: number[]): string {
  const refs = ids.map((id) => `[#image ${id}]`).join(", ");
  return `Could not resolve ${refs} to image paths; submitting unchanged.`;
}

async function submitPreservingHistory(
  mode: any,
  originalOnSubmit: (text: string) => unknown,
  historyText: string,
  submitText: string,
) {
  if (historyText === submitText) return originalOnSubmit(historyText);

  const editor = mode?.editor;
  const originalAddToHistory = editor?.addToHistory;
  if (typeof originalAddToHistory !== "function") {
    return originalOnSubmit(submitText);
  }

  const patchedAddToHistory = function patchedAddToHistory(
    this: any,
    text: string,
  ) {
    return originalAddToHistory.call(
      this,
      text === submitText ? historyText : text,
    );
  };

  editor.addToHistory = patchedAddToHistory;
  try {
    return await originalOnSubmit(submitText);
  } finally {
    if (editor.addToHistory === patchedAddToHistory) {
      editor.addToHistory = originalAddToHistory;
    }
  }
}

function imageSubmitBlockReason(
  drafts: ImageAttachmentsDrafts,
  mode: any,
  text: string,
): string | undefined {
  if (!drafts.hasImageSubmitIntent(text)) return undefined;

  if (mode?.settingsManager?.getBlockImages?.()) {
    return "Image reading is disabled. Enable images in /settings before sending image attachments.";
  }

  const model = mode?.session?.model;
  if (model && Array.isArray(model.input) && !model.input.includes("image")) {
    return `Current model (${model.id ?? "selected model"}) does not support image input. Switch to an image-capable model before sending image attachments.`;
  }

  return undefined;
}

export function installSubmitGuards(drafts: ImageAttachmentsDrafts) {
  const prototype = InteractiveMode.prototype as any;
  const state = (prototype[SUBMIT_GUARD_PATCH_STATE] ??= {
    originalSetupEditorSubmitHandler: prototype.setupEditorSubmitHandler,
  }) as SubmitGuardPatchState;

  prototype.setupEditorSubmitHandler = function patchedSetupEditorSubmitHandler(
    ...args: any[]
  ) {
    const result = state.originalSetupEditorSubmitHandler.apply(this, args);
    const originalOnSubmit = this.defaultEditor?.onSubmit;
    if (typeof originalOnSubmit !== "function") return result;

    this.defaultEditor.onSubmit = async (text: string) => {
      const isCommand = await isKnownBuiltinOrExtensionCommand(
        this,
        text.trim(),
      );
      const commandPathResult = isCommand
        ? drafts.imagePathTextForCommand(text)
        : undefined;
      if (commandPathResult?.unresolvedIds.length) {
        this.showWarning?.(
          unresolvedImageWarning(commandPathResult.unresolvedIds),
        );
      }

      const reason = isCommand
        ? undefined
        : imageSubmitBlockReason(drafts, this, text);
      if (reason) {
        this.showWarning?.(reason);
        this.editor?.setText?.(text);
        this.ui?.requestRender?.();
        return;
      }

      return submitPreservingHistory(
        this,
        originalOnSubmit,
        text,
        commandPathResult?.text ?? text,
      );
    };

    return result;
  };
}
