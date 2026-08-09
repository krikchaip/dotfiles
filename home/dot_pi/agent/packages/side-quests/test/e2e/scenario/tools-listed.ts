import { configureBasicDelegation } from "../provider-support.ts";

export const toolsListed: Scenario = {
  name: "tools-listed",
  process: { managed: true, positionalPrompt: "Delegate this E2E task now." },
  configureProvider(context) {
    configureBasicDelegation(context, { verifyAgentTool: true });
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("Subagent completed:");
  },
};
