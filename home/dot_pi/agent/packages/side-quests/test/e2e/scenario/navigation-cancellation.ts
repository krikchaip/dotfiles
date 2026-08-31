import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

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
    if (context.role === "child") {
      configureBasicDelegation(context, {
        interactive: true,
        prompt: "Stay open for navigation and cancellation E2E.",
      });
      return;
    }

    context.faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("Agent", {
            description: "first navigation child",
            interactive: true,
            prompt: "Stay open as the first navigation child.",
          }),
          fauxToolCall("Agent", {
            description: "second navigation child",
            interactive: true,
            prompt: "Stay open as the second navigation child.",
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("Both navigation children are open.")),
    ]);
  },
  async run(harness: E2EHarness) {
    const childPane = await harness.childPane();

    await harness.sendParentKeys("S-Up");
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

    await harness.sendKeys(childPane, "S-Up");
    await Bun.sleep(500);

    const parentActive = (
      await harness.tmux(
        "display-message",
        "-p",
        "-t",
        harness.parentPane,
        "#{window_active}",
      )
    ).trim();

    harness.assert(
      parentActive === "1",
      "Child Shift+Up did not return focus to the parent tmux pane.",
    );

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
    await Bun.sleep(250);
    const beforeConfirmedDeletion = harness.read(harness.logPath);
    await harness.sendParentKeys("Enter");
    await harness.waitFor("SUBAGENT CANCELLED");
    await harness.waitUntil(
      "one surviving managed child pane",
      async () => (await harness.childPanes()).length === 1,
      5_000,
    );

    const continuedNavigationView = await harness.capture();
    harness.assert(
      continuedNavigationView.includes("d close") &&
        continuedNavigationView.includes("›"),
      "Navigation closed after deleting one of multiple live children.",
    );

    await Bun.sleep(250);
    const confirmedDeletionOutput = harness
      .read(harness.logPath)
      .slice(beforeConfirmedDeletion.length);
    const confirmedDeletionRenders = confirmedDeletionOutput
      .split("\u001B[?2026h")
      .slice(1)
      .map((render) => render.split("\u001B[?2026l")[0] ?? render);
    const editorOnlyRender = confirmedDeletionRenders.some(
      (render) =>
        (render.includes("\u001B[7m ") ||
          render.includes("\u001B]133;B\u0007")) &&
        !render.includes("close"),
    );
    harness.assert(
      confirmedDeletionRenders.length > 0 && !editorOnlyRender,
      "Confirmed deletion briefly restored the editor before navigation.",
    );

    await harness.sendParent("d");
    await harness.waitFor("Close subagent?", 5_000);
    await harness.sendParentKeys("Enter");
    await harness.waitUntil(
      "no managed child panes",
      async () => (await harness.childPanes()).length === 0,
      5_000,
    );

    const emptyNavigationView = await harness.capture();
    harness.assert(
      !emptyNavigationView.includes("d close") &&
        !emptyNavigationView.includes("›"),
      "Navigation stayed open after deleting the final live child.",
    );
  },
};
