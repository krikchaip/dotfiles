/**
 * Clears Pi fullscreen text selection as soon as its native copy succeeds.
 *
 * Pi uses reverse video for selected text. The upstream selection handler copies
 * on mouse release but deliberately retains its selection range. This patch
 * clears that range after the existing clipboard write and its "Copied!" flash.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TuiAltScreen } from "@earendil-works/pi-tui";

const PATCH_STATE = Symbol.for("clear-copied-selection.patch");

type CopySelection = () => void;

type PatchableTui = {
  copySelectionToClipboard: CopySelection;
  selectionAnchor: unknown;
  selectionFocus: unknown;
  selectionInitialRange: unknown;
  selectionGranularity: "character" | "word" | "line";
};

type PatchablePrototype = PatchableTui &
  Record<symbol, { originalCopySelection: CopySelection } | undefined>;

function installPatch(): void {
  const prototype = TuiAltScreen.prototype as unknown as PatchablePrototype;
  if (prototype[PATCH_STATE]) return;

  const originalCopySelection = prototype.copySelectionToClipboard;
  if (typeof originalCopySelection !== "function") {
    throw new Error("TuiAltScreen.copySelectionToClipboard unavailable");
  }

  prototype[PATCH_STATE] = { originalCopySelection };
  prototype.copySelectionToClipboard = function patchedCopySelection(
    this: PatchableTui,
  ): void {
    originalCopySelection.call(this);
    this.selectionAnchor = undefined;
    this.selectionFocus = undefined;
    this.selectionInitialRange = undefined;
    this.selectionGranularity = "character";
  };
}

export default function clearCopiedSelection(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    try {
      installPatch();
    } catch (error) {
      console.error(
        "clear-copied-selection: failed to patch fullscreen TUI",
        error,
      );
    }
  });
}
