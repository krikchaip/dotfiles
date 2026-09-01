import { configureBasicDelegation } from "../provider-support.ts";

export const windowTitleFinalPaneClose: Scenario = {
  name: "window-title-final-pane-close",
  process: {
    lifecycle: "interactive",
    managed: true,
    positionalPrompt: "Delegate the final-pane title E2E task now.",
  },
  timeoutMs: 30_000,
  configureProvider(context) {
    configureBasicDelegation(context, {
      description: "Final pane title E2E",
      prompt: "Complete and close the only managed pane.",
    });
  },
  async run(harness: E2EHarness) {
    const beforeCompletion = harness.read(harness.logPath);
    await harness.waitFor("SUBAGENT COMPLETED", 15_000);
    await harness.waitUntil(
      "completed final managed pane to close",
      async () => (await harness.childPanes()).length === 0,
      5_000,
    );
    await Bun.sleep(2_200);

    const completionOutput = harness
      .read(harness.logPath)
      .slice(beforeCompletion.length);
    harness.assert(
      !completionOutput.includes("empty selected pane ID"),
      "Completing the only managed pane emitted a false title warning.",
    );
  },
};
