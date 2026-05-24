import {
  type ExtensionContext,
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

let _originalFn: ((msg?: string) => void) | null = null;
let _lastPureMsg: string | null = null;
let _defaultMsg = "Working...";

export default function (pi: ExtensionAPI) {
  function wrap(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;

    if (!_originalFn) {
      _originalFn = ctx.ui.setWorkingMessage.bind(ctx.ui);
    }

    // Always re-wrap — handles any un-patching between turns
    ctx.ui.setWorkingMessage = (msg?: string) => {
      if (typeof msg === "string" && msg.trim() !== "") {
        _lastPureMsg = msg;
        _originalFn!(msg + "\n");
      } else {
        // When cleared (undefined), the next non-null setWorkingMessage
        // in this turn will use the default. Capture the default text
        // for bg_task fallback.
        _lastPureMsg = null;
        _originalFn!(msg);
      }
    };
  }

  // Patch on events that fire before setWorkingMessage is written
  pi.on("session_start", async (_e: unknown, ctx: ExtensionContext) =>
    wrap(ctx),
  );
  pi.on("before_agent_start", async (_e: unknown, ctx: ExtensionContext) =>
    wrap(ctx),
  );
  pi.on("tool_call", async (_e: unknown, ctx: ExtensionContext) => wrap(ctx));

  // After internal agent_start creates the Loader, re-apply spacer so it
  // reaches the live animation (catches edge cases where the Loader was
  // created without our patched message).
  pi.on("agent_start", async (_e: unknown, ctx: ExtensionContext) => {
    if (!ctx.hasUI || !_originalFn) return;

    if (_lastPureMsg) {
      // Normal turn: a vibe was set via before_agent_start, re-apply with spacer
      _originalFn(_lastPureMsg + "\n");
    } else {
      // bg_task / triggerTurn path: no vibe was set, Loader has plain "Working...".
      // Add spacer to the default message so bg_task turns also get breathing room.
      _originalFn(_defaultMsg + "\n");
    }
  });

  // Clear stored message at turn end so we don't carry stale vibes across turns
  pi.on("turn_end", async () => {
    _lastPureMsg = null;
  });
}
