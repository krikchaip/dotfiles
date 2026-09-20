import { configureBasicDelegation } from "../provider-support.ts";

function scenario(name: string, explicit: boolean): Scenario {
  return {
    name,
    process: {
      agentDefinitions: { "general-purpose": "---\n---" },
      managed: true,
      positionalPrompt: "Launch the plain general-purpose child now.",
    },
    configureProvider(context) {
      configureBasicDelegation(context, {
        childSystemPromptExcludes: ["<agent_instructions>"],
        description: "plain general purpose",
        prompt: "Confirm the plain configuration.",
        ...(explicit ? { subagentType: "general-purpose" } : {}),
      });
    },
    async run(harness: E2EHarness) {
      const view = await harness.waitFor(
        "Child completed its delegated E2E task.",
        15_000,
      );
      harness.assert(
        view.includes("plain general purpose"),
        `Plain general-purpose child did not report its result.\n${view}`,
      );
    },
  };
}

export const emptyGeneralPurposeOmitted = scenario(
  "empty-general-purpose-omitted",
  false,
);
export const emptyGeneralPurposeExplicit = scenario(
  "empty-general-purpose-explicit",
  true,
);
