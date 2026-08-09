import { configureContinuation } from "../provider-support.ts";

export const activeContinuation: Scenario = {
  name: "active-continuation",
  process: { managed: true, positionalPrompt: "Delegate this E2E task now." },
  configureProvider(context) {
    configureContinuation(context, {
      childFirstResponse: "First active phase settled.",
      childFirstResponseDelayMs: 2_000,
      childSecondResponse: "Active continuation applied.",
      continuationDelayMs: 500,
      continuationPrompt: "Apply the active-continuation now.",
      launchPrompt: "Start active continuation E2E.",
    });
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("Subagent continued. Session:");
    await harness.waitFor("Subagent completed:");
  },
};
