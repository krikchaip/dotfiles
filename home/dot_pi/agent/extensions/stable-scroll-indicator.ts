/**
 * Keeps the fullscreen jump-to-latest indicator in one horizontal position.
 *
 * Pi centers this overlay inside the transcript width. An automatic scrollbar
 * removes one column only while it is visible. This changes the center point
 * and can move the overlay one column whenever scrolling shows the bar.
 *
 * During overlay composition, this patch always reserves the scrollbar column
 * for an automatic scrollbar. It does not force the scrollbar itself to stay
 * visible and does not change the transcript content width.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TuiAltScreen } from "@earendil-works/pi-tui";

const PATCH_STATE = Symbol.for("stable-scroll-indicator.patch");

type ScrollbarMode = "hidden" | "auto" | "always";

type PatchableScrollView = {
  currentScrollbar: ScrollbarMode;
  readonly scrollbar: ScrollbarMode;
  readonly isScrollbarVisible: boolean;
};

type IndicatorLayout = {
  primaryScrollView?: PatchableScrollView;
};

type CompositeIndicator = (
  screen: string[],
  layout: IndicatorLayout,
  width: number,
) => string[];

type PatchableTui = {
  implicitScrollView: PatchableScrollView;
  compositeScrollToEndIndicator: CompositeIndicator;
};

type PatchablePrototype = PatchableTui &
  Record<symbol, { originalComposite: CompositeIndicator } | undefined>;

function installPatch(): void {
  const prototype = TuiAltScreen.prototype as unknown as PatchablePrototype;
  if (prototype[PATCH_STATE]) return;

  const originalComposite = prototype.compositeScrollToEndIndicator;
  if (typeof originalComposite !== "function") {
    throw new Error("TuiAltScreen.compositeScrollToEndIndicator unavailable");
  }

  prototype[PATCH_STATE] = { originalComposite };
  prototype.compositeScrollToEndIndicator = function stableIndicator(
    this: PatchableTui,
    screen: string[],
    layout: IndicatorLayout,
    width: number,
  ): string[] {
    const scrollView = layout.primaryScrollView ?? this.implicitScrollView;
    if (
      width <= 1 ||
      scrollView.scrollbar !== "auto" ||
      scrollView.isScrollbarVisible
    ) {
      return originalComposite.call(this, screen, layout, width);
    }

    const originalScrollbar = scrollView.currentScrollbar;
    scrollView.currentScrollbar = "always";
    try {
      return originalComposite.call(this, screen, layout, width);
    } finally {
      scrollView.currentScrollbar = originalScrollbar;
    }
  };
}

export default function stableScrollIndicator(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    try {
      installPatch();
    } catch (error) {
      console.error(
        "stable-scroll-indicator: failed to patch fullscreen TUI",
        error,
      );
    }
  });
}
