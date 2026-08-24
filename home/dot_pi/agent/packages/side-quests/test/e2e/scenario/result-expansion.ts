import { configureBasicDelegation } from "../provider-support.ts";

const longResult =
  "The completed side quest verified parent questions, direct continuations, resumed tasks, inherited tool calls, narrow terminal wrapping, Unicode-safe truncation, durable session recovery, and host compositor compatibility before selecting the reference hierarchy for every terminal outcome. Expanded result marker.";

export const resultExpansion: Scenario = {
  name: "result-expansion",
  process: { managed: true, positionalPrompt: "Delegate this E2E task now." },
  configureProvider(context) {
    configureBasicDelegation(context, {
      childResponse: longResult,
      prompt: "Complete the result expansion E2E.",
    });
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("SUBAGENT COMPLETED");

    const collapsed = await harness.capture();

    harness.assert(
      collapsed.includes("to expand"),
      `The collapsed result did not show the effective expand hint.\n${collapsed}`,
    );
    harness.assert(
      !collapsed.includes("Expanded result marker."),
      `The collapsed result showed its complete long response.\n${collapsed}`,
    );

    await harness.sendParentKeys("C-o");
    await harness.waitFor("Expanded result marker.", 5_000);
    await harness.waitFor("session path:", 5_000);
  },
};
