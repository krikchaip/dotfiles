/**
 * Patch built-in keybindings
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Scrolls to the start (top) of the chat — opposite of ctrl+shift+g (jumpChatBottom).
  // Injects enough pageUp sequences to guarantee the compositor clamps at maxScrollOffset.
  // Each pageUp scrolls 10 lines; 9999 pageUps covers any realistic chat history.
  pi.registerShortcut("ctrl+g", {
    description: "Jump chat to start",
    handler: async () => {
      const pageUp = "\x1b[5~";
      process.stdin.emit("data", Buffer.from(pageUp.repeat(9999)));
    },
  });

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
