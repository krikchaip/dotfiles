import { configureContinuation } from "../provider-support.ts";

export const activeContinuation: Scenario = {
  name: "active-continuation",
  process: {
    extensionFixtures: ["test/e2e/fixture/delegating-tool-renderer.ts"],
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
    providerTokensPerSecond: 100,
  },
  configureProvider(context) {
    configureContinuation(context, {
      childFirstResponse: "First active phase settled.",
      childFirstResponseDelayMs: 15_000,
      childSecondResponse: "Active continuation applied.",
      continuationDelayMs: 500,
      continuationPrompt: "Apply the active-continuation now.",
      launchPrompt: "Start active continuation E2E.",
    });
  },
  async run(harness: E2EHarness) {
    await harness.waitForWithout(
      "Agent general-purpose (steered) :: Continue the E2E delegated task",
      /Agent .*\(resume(?:d)?\) :: Continue the E2E delegated task/u,
    );

    await harness.waitFor("SUBAGENT COMPLETED");
  },
};
