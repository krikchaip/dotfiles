/**
 * resumex — enhanced session picker
 *
 * Custom /resumex command with:
 *   - Live Markdown preview of highlighted session
 *   - Rename bumps modtime (session jumps to top of picker)
 *   - Auto-select current session on open
 *   - Allow deleting active session
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { openResumexPicker } from "./picker.ts";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("resumex", {
    description:
      "Enhanced session picker with live preview, rename-bump, and resume improvements",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("resumex requires interactive mode", "warning");
        return;
      }

      const result = await openResumexPicker(pi, ctx, ctx.newSession);

      if (result.kind === "selected") {
        const switchResult = await ctx.switchSession(result.sessionPath);
        if (switchResult.cancelled) {
          ctx.ui.notify("Session switch cancelled", "info");
        }
      } else if (result.kind === "newAfterDelete") {
        await ctx.newSession();
      } else if (result.kind === "dismissed" && result.reason === "exit") {
        ctx.shutdown();
      }

      // dismissed "cancel" → noop
    },
  });
}
