import { configureBasicDelegation } from "../provider-support.ts";

export const narrowWidgets: Scenario = {
  name: "narrow-widgets",
  process: {
    lifecycle: "interactive",
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
  },
  timeoutMs: 45_000,
  width: 44,
  configureProvider(context) {
    configureBasicDelegation(context, {
      description: "An intentionally long narrow widget description",
      interactive: true,
      prompt: "Stay open for narrow widgets E2E.",
    });
  },
  async run(harness: E2EHarness) {
    const childPane = await harness.childPane();

    await harness.waitFor("Side Quests · 1 live", 10_000);
    await harness.waitFor("A…", 5_000);
    await harness.tmux(
      "resize-window",
      "-t",
      childPane,
      "-x",
      "44",
      "-y",
      "30",
    );

    await Bun.sleep(1_500);

    const childView = await harness.capture(childPane);

    harness.assert(
      childView.includes("general-purpose") &&
        childView.includes("An intentional…") &&
        childView.includes("interactive"),
      `The child widget did not render its narrow identity and lifecycle.\n${childView}`,
    );

    await harness.sendLiteral(childPane, "/subagent-done", true);
    await harness.waitFor("Subagent completed:");
  },
};
