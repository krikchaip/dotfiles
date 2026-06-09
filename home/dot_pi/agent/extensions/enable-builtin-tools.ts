/**
 * Enable all built-in tools.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // By default, pi only activates four built-in tools: read, write, edit, bash.
  // This extension automatically discovers any additional inactive built-in tools
  // (e.g. grep, find, ls) and enables them at session start.
  pi.on("session_start", async (_event: unknown, _ctx: ExtensionContext) => {
    const active = pi.getActiveTools();
    const all = pi.getAllTools();
    const hiddenBuiltins = all
      .filter(
        (t) => t.sourceInfo.source === "builtin" && !active.includes(t.name),
      )
      .map((t) => t.name);

    if (hiddenBuiltins.length > 0) {
      pi.setActiveTools([...active, ...hiddenBuiltins]);
    }
  });
}
