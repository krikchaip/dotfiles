import { configureBasicDelegation } from "../provider-support.ts";

export const unmarkedClosure: Scenario = {
  name: "unmarked-closure",
  process: {
    lifecycle: "interactive",
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
  },
  configureProvider(context) {
    configureBasicDelegation(context, {
      interactive: true,
      prompt: "Stay open for unmarked closure E2E.",
    });
  },
  async run(harness: E2EHarness) {
    const childPane = await harness.childPane();
    await harness.tmux("kill-pane", "-t", childPane);
    await harness.waitFor("Subagent closed:");
  },
};
