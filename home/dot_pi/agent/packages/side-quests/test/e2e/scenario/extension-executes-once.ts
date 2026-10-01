import { join } from "node:path";

import { configureBasicDelegation } from "../provider-support.ts";

/** Proves a resolved direct extension executes once in each Pi process. */
export const extensionExecutesOnce: Scenario = {
  name: "agent-extension-executes-once",
  process: {
    agentDefinitions: {
      "general-purpose": "---\nextensions: false\n---\n",
    },
    extensionFixtures: ["test/e2e/fixture/extension-load-recorder.ts"],
    managed: true,
  },
  configureProvider(context) {
    configureBasicDelegation(context);
  },
  async run(harness: E2EHarness) {
    await harness.sendParent("Delegate this E2E task now.", true);
    await harness.waitFor("SUBAGENT COMPLETED");

    const loads = harness
      .read(join(harness.stateDirectory, "extension-loads.txt"))
      .trim()
      .split("\n");

    harness.assert(
      JSON.stringify(loads) === JSON.stringify(["parent", "child"]),
      `Resolved extension executed more than once: ${JSON.stringify(loads)}`,
    );
  },
};
