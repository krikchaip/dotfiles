import { configureBasicDelegation } from "../provider-support.ts";

export const projectOverridesGlobalAgent: Scenario = {
  name: "project-overrides-global-agent",
  process: {
    agentDefinitions: {
      evidence: [
        "---",
        "description: Project evidence review",
        "display_name: Project reviewer",
        "interactive: true",
        "---",
        "Use project-only evidence rules.",
      ].join("\n"),
    },
    globalAgentDefinitions: {
      evidence: [
        "---",
        "description: Global evidence review",
        "display_name: Global reviewer",
        "---",
        "Use global-only evidence rules.",
      ].join("\n"),
    },
    managed: true,
    positionalPrompt: "Launch the project reviewer now.",
  },
  configureProvider(context) {
    configureBasicDelegation(context, {
      childSystemPromptExcludes: ["Use global-only evidence rules."],
      childSystemPromptIncludes: ["Use project-only evidence rules."],
      expectedChildInteractive: true,
      description: "project evidence",
      prompt: "Review project evidence.",
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
    const view = await harness.waitFor("Project reviewer", 15_000, childPane);

    harness.assert(
      !view.includes("Global reviewer"),
      `Global display name overrode the project display name.\n${view}`,
    );
  },
};
