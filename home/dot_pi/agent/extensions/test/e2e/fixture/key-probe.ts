import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function keyProbe(pi: ExtensionAPI): void {
  for (const key of [
    "alt+a",
    "alt+z",
    "alt+shift+a",
    "alt+shift+z",
    "alt+0",
    "alt+9",
  ] as const) {
    pi.registerShortcut(key, {
      description: `E2E probe for ${key}`,
      handler: async (context) => {
        context.ui.notify(`KEY PROBE ${key}`, "info");
      },
    });
  }

  pi.on("session_start", (_event, context) => {
    if (context.mode !== "tui") return;
    context.ui.setWidget("key-probe", ["KEY PROBE READY"]);
  });
}
