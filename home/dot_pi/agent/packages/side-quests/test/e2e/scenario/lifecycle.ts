import { configureBasicDelegation } from "../provider-support.ts";

export const lifecycle: Scenario = {
  name: "lifecycle",
  process: { managed: true },
  configureProvider(context) {
    configureBasicDelegation(context);
  },
  async run(harness: E2EHarness) {
    await harness.sendParent("Delegate this E2E task now.", true);
    await harness.waitFor("Subagent completed:");
  },
};
