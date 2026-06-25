/**
 * Normalize legacy Kitty Alt key bytes into CSI-u sequences.
 *
 * Kitty can report keyboard protocol support while macOS Option-letter keys
 * still arrive as legacy ESC + key bytes. pi treats those bytes as ambiguous
 * once Kitty protocol is active, so convert them before keybinding matching.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function normalizeLegacyAlt(data: string): string | undefined {
  if (data.length !== 2 || data[0] !== "\x1b") return undefined;

  const code = data.charCodeAt(1);

  // Alt+a..z and Alt+0..9
  if ((code >= 97 && code <= 122) || (code >= 48 && code <= 57)) {
    return `\x1b[${code};3u`;
  }

  // Alt+Shift+a..z arrives as ESC + uppercase letter.
  if (code >= 65 && code <= 90) {
    return `\x1b[${code + 32};4u`;
  }

  return undefined;
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    ctx.ui.onTerminalInput((data) => {
      const normalized = normalizeLegacyAlt(data);
      if (!normalized) return undefined;
      return { data: normalized };
    });
  });
}
