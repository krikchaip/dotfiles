import { join } from "node:path";

import { configureBasicDelegation } from "../provider-support.ts";

/**
 * Proves a signed path removes one Direct baseline extension without losing peers.
 */
export const extensionDirectRemoval: Scenario = {
  name: "agent-extension-direct-removal",
  process: {
    extensionFixtures: ["test/e2e/fixture/extension-load-recorder.ts"],
    globalAgentDefinitions: {
      "general-purpose":
        "---\ntools: [read]\nextensions: [-./extensions/fixture-0.ts]\n---\n",
    },
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
  },
  configureProvider(context) {
    configureBasicDelegation(context);
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("SUBAGENT COMPLETED");
    harness.assert(
      harness.read(join(harness.stateDirectory, "extension-loads.txt")) ===
        "parent\n",
      "The removed Direct extension still ran in the child.",
    );
  },
};
