import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Adds one visible widget before Side Quests for attached-spacing verification. */
export default function registerWidgetBeforeFixture(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, context) => {
    if (context.mode !== "tui") return;

    context.ui.setWidget("spacing-visible-widget", ["Spacing fixture"], {
      placement: "aboveEditor",
    });
  });
}
