import { configureBasicDelegation } from "../provider-support.ts";

export const resultExpansion: Scenario = {
  name: "result-expansion",
  process: { managed: true, positionalPrompt: "Delegate this E2E task now." },
  configureProvider(context) {
    configureBasicDelegation(context, {
      prompt: "Complete the result expansion E2E.",
    });
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("Subagent completed:");

    const collapsed = await harness.capture();

    harness.assert(
      collapsed.includes("to expand"),
      `The collapsed result did not show the effective expand hint.\n${collapsed}`,
    );

    await harness.sendParentKeys("C-o");
    await harness.waitFor(
      "Result: Child completed its delegated E2E task.",
      5_000,
    );
  },
};
