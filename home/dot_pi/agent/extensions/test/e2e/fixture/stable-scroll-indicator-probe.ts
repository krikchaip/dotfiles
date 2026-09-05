import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text, TuiAltScreen } from "@earendil-works/pi-tui";

const PATCH_STATE = Symbol.for("stable-scroll-indicator-e2e.patch");
const CUSTOM_TYPE = "stable-scroll-indicator-e2e";

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
  scrollToEndIndicatorRect?: IndicatorRect;
};

type ProbePrototype = ProbeTui &
  Record<symbol, { originalComposite: ProbeTui["compositeScrollToEndIndicator"] } | undefined>;

export default function stableScrollIndicatorProbe(pi: ExtensionAPI): void {
  const capturePath = process.env.PI_E2E_SCROLL_INDICATOR_CAPTURE;
  if (!capturePath) {
    throw new Error("PI_E2E_SCROLL_INDICATOR_CAPTURE is required.");
  }

  pi.registerMessageRenderer(CUSTOM_TYPE, (message, options) =>
    new Text(message.content, options.outputPad, 0),
  );
  pi.registerCommand("e2e-scroll-indicator-seed", {
    description: "Fill the transcript for the scroll indicator probe",
    handler: async () => {
      pi.sendMessage({
        customType: CUSTOM_TYPE,
        content: Array.from(
          { length: 80 },
          (_, index) =>
            `SCROLL INDICATOR PROBE LINE ${String(index).padStart(2, "0")}`,
        ).join("\n"),
        display: true,
      });
    },
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    const prototype = TuiAltScreen.prototype as unknown as ProbePrototype;
    if (!prototype[PATCH_STATE]) {
      const originalComposite = prototype.compositeScrollToEndIndicator;
      prototype[PATCH_STATE] = { originalComposite };
      prototype.compositeScrollToEndIndicator = function captureIndicator(
        this: ProbeTui,
        screen: string[],
        layout: ProbeLayout,
        width: number,
      ): string[] {
        const result = originalComposite.call(this, screen, layout, width);
        const rect = this.scrollToEndIndicatorRect;
        const scrollView = layout.primaryScrollView;
        if (rect && scrollView) {
          appendFileSync(
            capturePath,
            `${JSON.stringify({
              column: rect.column,
              indicatorWidth: rect.width,
              scrollbarVisible: scrollView.isScrollbarVisible,
              terminalWidth: width,
            })}\n`,
          );
        }
        return result;
      };
    }

    ctx.ui.setWidget("stable-scroll-indicator-e2e", [
      "STABLE SCROLL INDICATOR PROBE READY",
    ]);
  });
}
