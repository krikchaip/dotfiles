import { writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  Image,
  TuiMainScreen,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";

const IMAGE_DATA = "A".repeat(5_000);
const PLACEHOLDER = String.fromCodePoint(0x10eeee);

export default function tmuxKittyImagesProbe(pi: ExtensionAPI): void {
  const capturePath = process.env.PI_E2E_TMUX_IMAGE_CAPTURE;
  if (!capturePath) throw new Error("PI_E2E_TMUX_IMAGE_CAPTURE is required.");

  let expandViewport: (() => void) | undefined;
  pi.registerCommand("e2e-tmux-scroll", {
    description: "Expand the image widget to force a native viewport repaint",
    handler: async (_args, context) => {
      if (!expandViewport) throw new Error("tmux image viewport is not ready");
      expandViewport();
      process.stdout.write("\x1b[?2026h\x1b[2;31r\x1b[r\x1b[?2026l");
      context.ui.notify("TMUX KITTY SCROLL READY", "info");
    },
  });
  pi.registerCommand("e2e-tmux-repaint", {
    description: "Emit one integrated scroll-region repaint through stdout",
    handler: async (_args, context) => {
      process.stdout.write("\x1b[?2026h\x1b[1;32r\x1b[r\x1b[?2026l");
      context.ui.notify("TMUX KITTY REPAINT READY", "info");
    },
  });

  pi.on("session_start", (_event, context) => {
    const imageTheme = {
      fallbackColor: (text: string) => context.ui.theme.fg("muted", text),
    };
    const first = new Image(
      IMAGE_DATA,
      "image/png",
      imageTheme,
      { maxWidthCells: 12, maxHeightCells: 5 },
      { widthPx: 32, heightPx: 18 },
    );
    const second = new Image(
      IMAGE_DATA,
      "image/png",
      imageTheme,
      { maxWidthCells: 20, maxHeightCells: 8 },
      { widthPx: 32, heightPx: 18 },
    );

    const firstLines = first.render(12);
    const secondLines = second.render(20);
    const baseLine = firstLines[0]!;
    const sharedPrototype = Object.getPrototypeOf(TuiMainScreen.prototype) as {
      compositeLineAt(
        base: string,
        overlay: string,
        start: number,
        overlayWidth: number,
        totalWidth: number,
      ): string;
    };
    const composed = sharedPrototype.compositeLineAt.call(
      {},
      baseLine,
      "OVER",
      2,
      4,
      12,
    );
    writeFileSync(
      capturePath,
      JSON.stringify({
        composed,
        composedWidth: visibleWidth(composed),
        placeholdersBefore: [
          ...composed.slice(0, composed.indexOf("OVER")),
        ].filter((character) => character === PLACEHOLDER).length,
        placeholdersAfter: [
          ...composed.slice(composed.indexOf("OVER") + 4),
        ].filter((character) => character === PLACEHOLDER).length,
      }),
    );

    let expanded = false;
    const component: Component = {
      invalidate() {
        first.invalidate();
        second.invalidate();
      },
      render(width) {
        const responsiveFirstLines = first.render(
          width >= 80 ? 12 : Math.max(3, Math.floor(width / 8)),
        );
        return [
          "TMUX KITTY IMAGE PROBE READY",
          ...responsiveFirstLines,
          ...secondLines,
          ...(expanded
            ? Array.from(
                { length: 80 },
                (_, index) =>
                  `TMUX KITTY SCROLL LINE ${String(index).padStart(2, "0")}`,
              )
            : []),
        ];
      },
    };
    expandViewport = () => {
      expanded = true;
      context.ui.setWidget("tmux-kitty-images-e2e", () => component);
    };
    context.ui.setWidget("tmux-kitty-images-e2e", () => component);
  });
}
