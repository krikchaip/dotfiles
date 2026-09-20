import {
  type Context,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import { configureBasicDelegation } from "../provider-support.ts";

const ROUTING_GUIDANCE =
  "When a side quest matches a specialized sub-agent below, delegate that side quest directly to that sub-agent.";
const CATALOG_ENTRY = "Subagent baseline. Review baseline inheritance";

export const descriptionOnlyNamedAgent: Scenario = {
  name: "description-only-named-agent",
  process: {
    agentDefinitions: {
      baseline: "---\ndescription: Review baseline inheritance\n---\n",
    },
    managed: true,
    positionalPrompt: "Launch the description-only baseline reviewer.",
  },
  configureProvider(context) {
    if (context.role === "child") {
      configureBasicDelegation(context, {
        childSystemPromptExcludes: ["<agent_instructions>"],
        childToolExcludes: ["Agent"],
        childToolIncludes: ["read"],
      });
      return;
    }

    context.faux.setResponses([
      (providerContext: Context) => {
        const prompt = providerContext.systemPrompt ?? "";
        const catalogIsCorrect =
          prompt.includes(ROUTING_GUIDANCE) && prompt.includes(CATALOG_ENTRY);
        return catalogIsCorrect
          ? fauxAssistantMessage(
              fauxToolCall("Agent", {
                description: "baseline inheritance",
                prompt: "Verify the inherited baseline.",
                subagent_type: "baseline",
              }),
              { stopReason: "toolUse" },
            )
          : fauxAssistantMessage("Description-only catalog is missing.", {
              stopReason: "error",
              errorMessage: "Description-only catalog is missing.",
            });
      },
      fauxAssistantMessage(fauxText("Description-only named child launched.")),
      fauxAssistantMessage(fauxText("Description-only named child completed.")),
    ]);
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("SUBAGENT COMPLETED", 15_000);
    const manifest = harness.filesNamed("manifest.json")[0];
    harness.assert(manifest, "Description-only child manifest is missing.");
    const content = harness.read(manifest);

    harness.assert(
      content.includes('"agentName":"baseline"') &&
        content.includes('"displayName":"baseline"') &&
        content.includes('"model":"side-quests-e2e/fake"') &&
        content.includes('"thinking":"off"') &&
        content.includes('"inheritContext":true') &&
        content.includes('"lifecycle":"autonomous"'),
      `Description-only definition did not preserve the parent baseline.\n${content}`,
    );
  },
};
