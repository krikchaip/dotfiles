import { configureBasicDelegation } from "../provider-support.ts";

export const interactive: Scenario = {
  name: "interactive",
  process: {
    lifecycle: "interactive",
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
  },
  configureProvider(context) {
    configureBasicDelegation(context, { interactive: true });
  },
  async run(harness: E2EHarness) {
    const childPane = await harness.childPane();
    await Bun.sleep(1_000);
    await harness.sendLiteral(childPane, "/subagent-done", true);
    await harness.waitFor("SUBAGENT COMPLETED");
  },
};
