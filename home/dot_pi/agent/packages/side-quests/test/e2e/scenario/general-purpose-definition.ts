import { configureBasicDelegation } from "../provider-support.ts";

export const generalPurposeDefinition: Scenario = {
  name: "general-purpose-definition",
  process: {
    agentDefinitions: {
      "general-purpose": [
        "---",
        "inherit_context: false",
        "interactive: true",
        "---",
        "Use the general-purpose evidence checklist.",
      ].join("\n"),
    },
    managed: true,
    positionalPrompt: "Launch a general-purpose reviewer now.",
  },
  configureProvider(context) {
    configureBasicDelegation(context, {
      childSystemPromptIncludes: [
        "Use the general-purpose evidence checklist.",
      ],
      expectedChildInteractive: true,
      description: "general evidence",
      prompt: "Review the evidence.",
    });
  },
  async run(harness: E2EHarness) {
    const childPane = await harness.childPane();
    await harness.waitFor(
      "Child completed its delegated E2E task.",
      15_000,
      childPane,
    );
    const view = await harness.waitFor("general evidence", 15_000, childPane);

    harness.assert(
      view.includes("interactive") && !view.includes("inherited"),
      `General-purpose frontmatter defaults were not applied.\n${view}`,
    );
  },
};
