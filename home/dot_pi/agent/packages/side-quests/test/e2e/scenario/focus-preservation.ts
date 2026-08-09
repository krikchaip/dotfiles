import { configureBasicDelegation } from "../provider-support.ts";

export const focusPreservation: Scenario = {
  name: "focus-preservation",
  process: {
    lifecycle: "interactive",
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
  },
  timeoutMs: 45_000,
  configureProvider(context) {
    configureBasicDelegation(context, {
      interactive: true,
      prompt: "Stay open for focus preservation E2E.",
    });
  },
  async run(harness: E2EHarness) {
    const childPane = await harness.childPane();
    const active = (
      await harness.tmux(
        "display-message",
        "-p",
        "-t",
        harness.parentPane,
        "#{window_active}",
      )
    ).trim();

    harness.assert(
      active === "1",
      "Detached child launch stole focus from the parent window.",
    );

    await Bun.sleep(1_000);
    await harness.sendLiteral(childPane, "/subagent-done", true);
    await harness.waitFor("Subagent completed:");
  },
};
