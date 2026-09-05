import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function skillExpansionInputs(pi: ExtensionAPI): void {
  pi.registerCommand("e2e-custom-skill", {
    description: "Send a custom skill-reference message",
    handler: async () => {
      pi.sendMessage(
        {
          customType: "skill-expansion-e2e",
          content: "CUSTOM_SKILL_MARKER /alpha",
          display: false,
        },
        { triggerTurn: true },
      );
    },
  });
}
