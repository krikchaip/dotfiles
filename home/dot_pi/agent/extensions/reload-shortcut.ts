/**
 * /reload keyboard shortcut
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Maps Ctrl+Alt+R to the interactive /reload command.
  // It uses the raw input stream to clear the prompt box (Ctrl+C)
  // and submit the /reload command, bypassing the standard
  // sendUserMessage API which doesn't expand slash commands.
  pi.registerShortcut("ctrl+alt+r", {
    description: "Reload keybindings, extensions, skills, prompts, and themes",
    handler: async () => {
      // \x03 (Ctrl+C) clears the editor box
      // Then type /reload and press Enter (\r)
      process.stdin.emit("data", Buffer.from("\x03/reload\r"));
    },
  });
}
