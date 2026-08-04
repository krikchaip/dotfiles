import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { installParent } from "./parent/index.ts";
import {
  UNSUPPORTED_TMUX_WARNING,
  currentEnvironment,
  detectRole,
} from "./role.ts";

/**
 * Public package entrypoint. It registers only the parent surface.
 * Managed children load child/index.ts explicitly; this entrypoint is inert there.
 */
export default function (pi: ExtensionAPI): void {
  switch (detectRole(currentEnvironment())) {
    case "inert": {
      let warned = false;
      pi.on("session_start", (_event, context) => {
        if (warned) return;
        warned = true;
        context.ui.notify(UNSUPPORTED_TMUX_WARNING, "warning");
      });
      return;
    }
    case "child":
      return;
    case "parent":
      installParent(pi);
  }
}
