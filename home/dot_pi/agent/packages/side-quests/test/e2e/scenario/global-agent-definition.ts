import { configureBasicDelegation } from "../provider-support.ts";

export const globalAgentDefinition: Scenario = {
  name: "global-agent-definition",
  process: {
    globalAgentDefinitions: {
      evidence: [
        "---",
        "description: Review implementation evidence",
        "display_name: Global evidence reviewer",
        "inherit_context: false",
        "interactive: true",
        "---",
        "Return only file-based evidence.",
      ].join("\n"),
    },
    managed: true,
    positionalPrompt: "Launch the global evidence reviewer now.",
  },
  configureProvider(context) {
    configureBasicDelegation(context, {
      childSystemPromptIncludes: ["Return only file-based evidence."],
      expectedChildInteractive: true,
      description: "review evidence",
      prompt: "Review the change evidence.",
      subagentType: "evidence",
    });
  },
  async run(harness: E2EHarness) {
    const childPane = await harness.childPane();
    await harness.waitFor(
      "Child completed its delegated E2E task.",
      15_000,
      childPane,
    );
    const view = await harness.waitFor(
      "Global evidence reviewer",
      15_000,
      childPane,
    );

    harness.assert(
      view.includes("review evidence"),
      `Global named agent did not launch.\n${view}`,
    );
  },
};
