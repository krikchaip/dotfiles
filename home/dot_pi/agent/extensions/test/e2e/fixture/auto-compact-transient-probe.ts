import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function autoCompactTransientProbe(pi: ExtensionAPI): void {
  pi.registerCommand("e2e-auto-compact-transient", {
    description:
      "Send the auto-compact continuation as a triggered custom message",
    handler: async () => {
      pi.sendMessage(
        {
          customType: "auto-compact-continuation",
          content:
            "Continue from the completed tool results without repeating completed work. Follow any newer user instruction first.",
          display: false,
        },
        { deliverAs: "followUp", triggerTurn: true },
      );
    },
  });
}
