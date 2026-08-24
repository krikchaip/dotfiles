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
    await harness.waitFor(
      "Agent general-purpose (resumed) :: Continue the E2E delegated task",
    );

    const childPane = await harness.childPane();

    const continuationView = await harness.waitFor(
      "FROM PARENT",
      5_000,
      childPane,
    );
    const continuationStart = continuationView.lastIndexOf("FROM PARENT");
    const continuationBanner = continuationView.slice(
      Math.max(0, continuationStart),
    );
    harness.assert(
      continuationBanner.includes("Apply the idle-continuation now.") &&
        !continuationBanner.includes("YOUR QUESTION") &&
        !continuationBanner.includes("IN RESPONSE TO"),
      `The direct continuation did not render without question context.\n${continuationBanner}`,
    );

    await harness.waitForStoredText("Idle continuation applied.");
    await harness.sendLiteral(childPane, "/subagent-done", true);
    await harness.waitFor("SUBAGENT COMPLETED");
  },
};
