import { configureContinuation } from "../provider-support.ts";

export const programmaticContinuation: Scenario = {
  name: "programmatic-continuation",
  process: { managed: true, positionalPrompt: "Delegate this E2E task now." },
  configureProvider(context) {
    configureContinuation(context, {
      childFirstResponse: "First programmatic phase settled.",
      childFirstResponseDelayMs: 2_000,
      childSecondResponse: "Programmatic continuation applied.",
      continuationDelayMs: 500,
      continuationPrompt: "Apply the programmatic-continuation now.",
      launchPrompt: "Start programmatic continuation E2E.",
    });
  },
  async run(harness: E2EHarness) {
    await harness.waitFor(
      "Agent general-purpose (resumed) :: Continue the E2E delegated task",
    );
    await harness.childPane();

    const manifest = harness.filesNamed("manifest.json")[0];

    harness.assert(manifest, "The continued child manifest is missing.");
    harness.assert(
      harness.read(manifest).includes('"lifecycle":"autonomous"'),
      "Programmatic Agent.resume promoted an autonomous child.",
    );

    await harness.waitFor("SUBAGENT COMPLETED");
  },
};
