import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TuiAltScreen } from "@earendil-works/pi-tui";

const PATCH_STATE = Symbol.for("selection-e2e-probe.patch");

type ProbeTui = {
  selectionAnchor?: unknown;
  selectionFocus?: unknown;
  selectionInitialRange?: unknown;
  selectionGranularity?: unknown;
  requestRender?(): void;
};

export default function selectionProbe(pi: ExtensionAPI): void {
  const path = process.env.PI_E2E_SELECTION_CAPTURE;
  if (!path) throw new Error("PI_E2E_SELECTION_CAPTURE is required.");

  const prototype = TuiAltScreen.prototype as unknown as ProbeTui &
    Record<symbol, boolean | undefined> & {
      copySelectionToClipboard(): Promise<void>;
    };
  if (!prototype[PATCH_STATE]) {
    prototype[PATCH_STATE] = true;
    prototype.copySelectionToClipboard = async function fakeClipboardCopy(
      this: ProbeTui,
    ): Promise<void> {
      appendFileSync(
        path,
        `${JSON.stringify({
          anchor: this.selectionAnchor,
          focus: this.selectionFocus,
          initialRange: this.selectionInitialRange,
          granularity: this.selectionGranularity,
        })}\n`,
      );
      setTimeout(() => this.requestRender?.(), 0);
    };
  }

  pi.on("session_start", (_event, context) => {
    if (context.mode !== "tui") return;
    context.ui.setWidget("selection-e2e", [
      "COPY_SELECTION_TARGET_ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      "COPY SELECTION PROBE READY",
    ]);
  });
}
