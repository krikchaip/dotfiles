import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  Image,
  TuiAltScreen,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";

const CUSTOM_TYPE = "tmux-kitty-scroll-indicator-e2e";
const PLACEHOLDER = String.fromCodePoint(0x10eeee);
const PATCH_STATE = Symbol.for("tmux-kitty-scroll-indicator-e2e.patch");
const IMAGE_DATA = "A".repeat(5_000);

type IndicatorRect = {
  row: number;
  column: number;
  width: number;
};

type ProbeScrollView = {
  isScrollbarVisible: boolean;
};

type ProbeLayout = {
  primaryScrollView?: ProbeScrollView;
};

type ProbeTui = {
  compositeScrollToEndIndicator(
    screen: string[],
    layout: ProbeLayout,
    width: number,
  ): string[];
  implicitScrollView: ProbeScrollView;
  scrollToEndIndicatorRect?: IndicatorRect;
};

type ProbePrototype = ProbeTui &
  Record<
    symbol,
    | {
        originalComposite: ProbeTui["compositeScrollToEndIndicator"];
      }
    | undefined
  >;

class ScrollIndicatorImage implements Component {
  constructor(private readonly image: InstanceType<typeof Image>) {}

  invalidate(): void {
    this.image.invalidate();
  }

  render(width: number): string[] {
    const imageLines = this.image.render(width);
    return [
      ...Array.from(
        { length: 18 },
        (_, index) => `BEFORE IMAGE ${String(index).padStart(2, "0")}`,
      ),
      ...imageLines,
      ...Array.from(
        { length: 48 },
        (_, index) => `AFTER IMAGE ${String(index).padStart(2, "0")}`,
      ),
    ];
  }
}

export default function tmuxKittyScrollIndicatorProbe(
  pi: ExtensionAPI,
): void {
  const capturePath = process.env.PI_E2E_TMUX_SCROLL_INDICATOR_CAPTURE;
  if (!capturePath) {
    throw new Error("PI_E2E_TMUX_SCROLL_INDICATOR_CAPTURE is required.");
  }

  pi.registerMessageRenderer(CUSTOM_TYPE, (_message, _options, theme) => {
    const image = new Image(
      IMAGE_DATA,
      "image/png",
      { fallbackColor: (text) => theme.fg("muted", text) },
      { maxWidthCells: 88, maxHeightCells: 40 },
      { widthPx: 88, heightPx: 40 },
    );
    return new ScrollIndicatorImage(image);
  });

  pi.registerCommand("e2e-tmux-scroll-indicator-seed", {
    description: "Seed a fullscreen transcript with a large U=1 image",
    handler: async () => {
      pi.sendMessage({
        customType: CUSTOM_TYPE,
        content: "fullscreen image scroll indicator probe",
        display: true,
      });
    },
  });

  pi.on("session_start", (_event, context) => {
    const prototype = TuiAltScreen.prototype as unknown as ProbePrototype;
    if (!prototype[PATCH_STATE]) {
      const originalComposite = prototype.compositeScrollToEndIndicator;
      prototype[PATCH_STATE] = { originalComposite };
      prototype.compositeScrollToEndIndicator = function captureComposition(
        this: ProbeTui,
        screen: string[],
        layout: ProbeLayout,
        width: number,
      ): string[] {
        const result = originalComposite.call(this, screen, layout, width);
        const rect = this.scrollToEndIndicatorRect;
        if (!rect) return result;

        const baseLine = screen[rect.row];
        const resultLine = result[rect.row];
        if (!baseLine?.includes(PLACEHOLDER) || !resultLine) return result;

        const scrollView = layout.primaryScrollView ?? this.implicitScrollView;
        appendFileSync(
          capturePath,
          `${JSON.stringify({
            baseLine,
            resultLine,
            baseWidth: visibleWidth(baseLine),
            resultWidth: visibleWidth(resultLine),
            basePlaceholders: [...baseLine].filter(
              (character) => character === PLACEHOLDER,
            ).length,
            resultPlaceholders: [...resultLine].filter(
              (character) => character === PLACEHOLDER,
            ).length,
            rect,
            terminalWidth: width,
            scrollbarVisible: scrollView.isScrollbarVisible,
          })}\n`,
        );
        return result;
      };
    }

    context.ui.setWidget("tmux-kitty-scroll-indicator-e2e", [
      "TMUX KITTY SCROLL INDICATOR PROBE READY",
    ]);
  });
}
