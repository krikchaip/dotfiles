import { existsSync } from "node:fs";
import { join } from "node:path";

import { configureBasicDelegation } from "../provider-support.ts";

/**
 * Omission preserves a parent started with reduced extension discovery.
 */
export const extensionReducedParentSnapshot: Scenario = {
  name: "agent-extensions-inherit-reduced-parent",
  process: {
    agentDefinitions: {
      "general-purpose": "---\ntools: [read]\n---\n",
    },
    extensionFixtures: ["test/e2e/fixture/extension-load-recorder.ts"],
    managed: true,
    noExtensions: true,
    positionalPrompt: "Delegate this E2E task now.",
  },
  configureProvider(context) {
    configureBasicDelegation(context);
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("SUBAGENT COMPLETED");
    harness.assert(
      !existsSync(join(harness.stateDirectory, "extension-loads.txt")),
      "Omission loaded an extension absent from the parent snapshot.",
    );
  },
};
