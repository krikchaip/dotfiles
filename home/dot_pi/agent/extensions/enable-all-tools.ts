/**
 * Enable All Tools
 *
 * Enables all 7 built-in tools (read, write, edit, bash, grep, find, ls)
 * plus any tools registered by extensions/packages, instead of the default 4.
 *
 * This replaces the need for `--tools read,write,edit,bash,grep,find,ls`
 * or any other CLI flags. Just drop this in ~/.pi/agent/extensions/ and it works.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event: unknown, _ctx: ExtensionContext) => {
    const allToolNames = pi.getAllTools().map((t) => t.name);
    pi.setActiveTools(allToolNames);
  });
}
