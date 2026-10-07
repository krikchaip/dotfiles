import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { formatNumber } from "@oh-my-pi/pi-utils";
import { formatContextUsage } from "@oh-my-pi/pi-tui/chrome";
import { SEGMENTS, type SegmentContext, type StatusLineSegment } from "@oh-my-pi/pi-tui/status-line";

interface ContextTokenSegment extends Omit<StatusLineSegment, "id"> {
  id: "context_tokens";
}

const nativeContext = SEGMENTS.context_pct;
const registry = SEGMENTS as Record<string, StatusLineSegment | ContextTokenSegment | undefined>;
let owners = 0;

function tokenLabel(ctx: SegmentContext) {
  return `${formatNumber(ctx.contextTokens)}/${ctx.contextWindow > 0 ? formatNumber(ctx.contextWindow) : "?"}`;
}

// Reuse native colors, icons, threshold warnings and compaction animation.
// Only the context label changes; the built-in context_pct stays untouched.
const tokenSegment: ContextTokenSegment = {
  id: "context_tokens",
  render(ctx) {
    const rendered = nativeContext.render(ctx);
    // Keep the native capacity-only label while context occupancy is unknown.
    if (ctx.contextPercent === null && ctx.contextWindow > 0) return rendered;
    const label = formatContextUsage(ctx.contextPercent, ctx.contextWindow, ctx.contextTokens);
    return { ...rendered, content: rendered.content.replace(label, tokenLabel(ctx)) };
  },
  describe(ctx) {
    const view = nativeContext.describe(ctx);
    if (!view || (ctx.contextPercent === null && ctx.contextWindow > 0)) return view;
    return {
      ...view,
      spans: view.spans.map((span, index) => index === 0 ? { ...span, t: tokenLabel(ctx) } : span),
    };
  },
};

/** Add context_tokens to custom layouts without changing built-in presets. */
export default function (pi: ExtensionAPI) {
  let installed = false;
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui" || ctx.agent.kind !== "main" || installed) return;
    registry.context_tokens = tokenSegment;
    owners++;
    installed = true;
  });
  pi.on("session_shutdown", () => {
    if (!installed) return;
    installed = false;
    owners--;
    if (owners === 0 && registry.context_tokens === tokenSegment) delete registry.context_tokens;
  });
}
