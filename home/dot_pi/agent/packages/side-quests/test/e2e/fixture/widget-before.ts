import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Adds one visible parent widget before Side Quests for spacing verification.
 */
export default function registerWidgetBeforeFixture(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, context) => {
    if (context.mode !== "tui" || process.env.PI_SIDE_QUESTS_CHILD_ID) return;

    context.ui.setWidget("spacing-visible-widget", ["Spacing fixture"], {
      placement: "aboveEditor",
    });
  });
}
