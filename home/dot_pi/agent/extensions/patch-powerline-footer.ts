import {
  type ExtensionContext,
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  function ensureWorkingSpacer(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;

    // Check if we already wrapped it by looking for our custom flag
    if ((ctx.ui.setWorkingMessage as any)._isSpacerWrapped) return;

    const originalSetWorkingMessage = ctx.ui.setWorkingMessage.bind(ctx.ui);

    const wrapped = (msg?: string) => {
      if (typeof msg === "string" && msg.trim() !== "") {
        originalSetWorkingMessage(msg + "\n ");
      } else {
        originalSetWorkingMessage(msg);
      }
    };

    (wrapped as any)._isSpacerWrapped = true;
    ctx.ui.setWorkingMessage = wrapped;
  }

  // Hook everywhere to ensure wrapper survives turn boundaries
  pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) =>
    ensureWorkingSpacer(ctx),
  );
  pi.on("before_agent_start", async (_event: unknown, ctx: ExtensionContext) =>
    ensureWorkingSpacer(ctx),
  );
  pi.on("tool_call", async (_event: unknown, ctx: ExtensionContext) =>
    ensureWorkingSpacer(ctx),
  );
}
