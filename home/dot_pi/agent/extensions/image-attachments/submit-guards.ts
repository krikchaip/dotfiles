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

type SubmitGuardPatchState = {
  originalSetupEditorSubmitHandler: (...args: any[]) => any;
};

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
      const reason = imageSubmitBlockReason(drafts, this, text);
      if (reason) {
        this.showWarning?.(reason);
        this.editor?.setText?.(text);
        this.ui?.requestRender?.();
        return;
      }

      return originalOnSubmit(text);
    };

    return result;
  };
}
