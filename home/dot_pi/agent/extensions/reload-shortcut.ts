/**
 * /reload keyboard shortcut
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const description =
    "Reload keybindings, extensions, skills, prompts, and themes";

  // sendUserMessage dispatches extension commands, but not Pi's built-in
  // /reload command. This command exposes the supported ctx.reload() API to
  // the shortcut without injecting bytes into the terminal input stream.
  pi.registerCommand("__reload-shortcut", {
    handler: async (_args, ctx) => {
      await ctx.reload();
    },
  });

  pi.registerShortcut("ctrl+alt+r", {
    description,
    handler: () => {
      pi.sendUserMessage("/__reload-shortcut", { expandPromptTemplates: true });
    },
  });
}
