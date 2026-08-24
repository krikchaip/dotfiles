import { configureBasicDelegation } from "../provider-support.ts";

export const navigationCancellation: Scenario = {
  name: "navigation-cancellation",
  process: {
    lifecycle: "interactive",
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
  },
  timeoutMs: 45_000,
  configureProvider(context) {
    configureBasicDelegation(context, {
      interactive: true,
      prompt: "Stay open for navigation and cancellation E2E.",
    });
  },
  async run(harness: E2EHarness) {
    const childPane = await harness.childPane();

    await harness.sendParent("/side-quests", true);
    await harness.waitFor("close", 5_000);

    const navigationView = await harness.capture();

    harness.assert(
      navigationView.includes("d close"),
      "Navigation did not render the literal close-key hint.",
    );
    harness.assert(
      navigationView.includes("›"),
      "Navigation did not mark the selected live-child row.",
    );

    await harness.sendParentKeys("Enter");
    await Bun.sleep(500);

    const active = (
      await harness.tmux(
        "display-message",
        "-p",
        "-t",
        childPane,
        "#{window_active}",
      )
    ).trim();

    harness.assert(
      active === "1",
      "Navigation confirm did not activate the managed child window.",
    );

    const parentWindow = (
      await harness.tmux(
        "display-message",
        "-p",
        "-t",
        harness.parentPane,
        "#{window_id}",
      )
    ).trim();

    await harness.tmux("select-window", "-t", parentWindow);

    await harness.sendParent("/side-quests", true);
    await harness.waitFor("close", 5_000);
    await harness.sendParent("d");
    await harness.waitFor("Close subagent?", 5_000);
    await harness.sendParentKeys("Down", "Enter");

    await Bun.sleep(500);

    const surviving = (
      await harness.tmux("display-message", "-p", "-t", childPane, "#{pane_id}")
    ).trim();

    harness.assert(
      surviving === childPane,
      "Cancelling close confirmation removed the child pane.",
    );

    await harness.sendParent("/side-quests", true);
    await harness.waitFor("close", 5_000);
    await harness.sendParent("d");
    await harness.waitFor("Yes", 5_000);
    await harness.sendParentKeys("Enter");
    await harness.waitFor("SUBAGENT CANCELLED");
  },
};
