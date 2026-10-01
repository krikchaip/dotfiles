import { configureBasicDelegation } from "../provider-support.ts";

/**
 * Removing an inherited extension also removes tools provided only by it.
 */
export const extensionToolPruning: Scenario = {
  name: "agent-extension-tool-pruning",
  timeoutMs: 15_000,
  process: {
    extensionFixtures: ["test/e2e/fixture/parent-owned-tool.ts"],
    globalAgentDefinitions: {
      "general-purpose": "---\nextensions: [-./extensions/fixture-0.ts]\n---\n",
    },
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
  },
  configureProvider(context) {
    configureBasicDelegation(context, {
      childToolExcludes: ["parent_owned_search"],
    });
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("SUBAGENT COMPLETED");
    const path = harness.filesNamed("manifest.json")[0];
    harness.assert(path, "Child capability manifest is missing.");
    const manifest = JSON.parse(harness.read(path));
    harness.assert(
      !manifest.tools.includes("parent_owned_search"),
      "The removed extension's parent tool remained in the child manifest.",
    );
  },
};
