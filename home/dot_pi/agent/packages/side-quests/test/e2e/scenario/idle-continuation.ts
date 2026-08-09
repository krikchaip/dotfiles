import { configureContinuation } from "../provider-support.ts";

export const idleContinuation: Scenario = {
  name: "idle-continuation",
  process: {
    lifecycle: "interactive",
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
  },
  configureProvider(context) {
    configureContinuation(context, {
      childFirstResponse: "First idle phase settled.",
      childSecondResponse: "Idle continuation applied.",
      continuationDelayMs: 1_500,
      continuationPrompt: "Apply the idle-continuation now.",
      interactive: true,
      launchPrompt: "Start idle continuation E2E.",
    });
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("Subagent continued. Session:");

    const childPane = await harness.childPane();

    await harness.waitForStoredText("Idle continuation applied.");
    await harness.sendLiteral(childPane, "/subagent-done", true);
    await harness.waitFor("Subagent completed:");
  },
};
