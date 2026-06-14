/**
 * Makes built-in dialog top/bottom borders use the themed accent border color.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";

const PATCH_STATE = Symbol.for("themed-dialog-borders.dynamic-border.patch");

type DynamicBorderInstance = {
  color?: (text: string) => string;
};

type PatchState = {
  originalRender: (this: DynamicBorderInstance, width: number) => string[];
  accent: (text: string) => string;
};

function isDefaultBorderColor(color: unknown) {
  if (typeof color !== "function") return true;
  return String(color).includes('theme.fg("border"');
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    const prototype =
      DynamicBorder.prototype as unknown as DynamicBorderInstance & {
        [PATCH_STATE]?: PatchState;
        render(width: number): string[];
      };

    const accent = (text: string) => ctx.ui.theme.fg("accent", text);
    const state = prototype[PATCH_STATE];
    if (state) {
      state.accent = accent;
      return;
    }

    const originalRender = prototype.render;
    const nextState: PatchState = { originalRender, accent };
    prototype[PATCH_STATE] = nextState;

    prototype.render = function patchedRender(
      this: DynamicBorderInstance,
      width: number,
    ) {
      if (!isDefaultBorderColor(this.color)) {
        return nextState.originalRender.call(this, width);
      }
      return [nextState.accent("─".repeat(Math.max(1, width)))];
    };
  });
}
