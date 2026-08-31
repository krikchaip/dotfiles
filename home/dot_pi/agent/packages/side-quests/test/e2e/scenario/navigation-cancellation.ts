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
    let childPane = "";
    await harness.waitUntil(
      "two managed child panes",
      async () => {
        const panes = await harness.childPanes();
        childPane = panes[1] ?? "";
        return panes.length === 2;
      },
      15_000,
    );
    await harness.waitFor("[general-purpose]", 15_000, childPane);

    await harness.sendParentKeys("S-Up");
    await harness.waitFor("close", 5_000);
    await harness.sendParentKeys("Down");

    let navigationView = "";
    await harness.waitUntil(
      "navigation to select the second live child",
      async () => {
        navigationView = await harness.capture();
        return navigationView
          .split("\n")
          .some(
            (line) =>
              line.includes("›") && line.includes("second navigation child"),
          );
      },
      5_000,
    );
    const navigationHintLine = navigationView
      .split("\n")
      .find((line) => line.includes("d close"));

    harness.assert(
      navigationHintLine?.search(/\S/) === 3,
      "Navigation key hints did not align with the widget content.",
    );
    await harness.sendParentKeys("Enter");
    await harness.waitUntil(
      "navigation to activate the managed child window",
      async () =>
        (
          await harness.tmux(
            "display-message",
            "-p",
            "-t",
            childPane,
            "#{window_active}",
          )
        ).trim() === "1",
      5_000,
    );

    await harness.sendLiteral(childPane, "\u001B[1;2A");
    await harness.waitUntil(
      "child Shift+Up to activate the parent window",
      async () =>
        (
          await harness.tmux(
            "display-message",
            "-p",
            "-t",
            harness.parentPane,
            "#{window_active}",
          )
        ).trim() === "1",
      5_000,
    );

    const retainedNavigationView = await harness.waitFor("d close", 5_000);
    harness.assert(
      retainedNavigationView
        .split("\n")
        .some(
          (line) =>
            line.includes("›") && line.includes("second navigation child"),
        ),
      "Pane navigation closed or lost the last selected row after returning.",
    );
    await Bun.sleep(250);
    const beforeConfirmation = harness.read(harness.logPath);
    await harness.sendParent("d");
    const confirmationView = await harness.waitFor("Close subagent?", 5_000);
    await Bun.sleep(250);
    const confirmationOutput = harness
      .read(harness.logPath)
      .slice(beforeConfirmation.length);
    const confirmationLines = confirmationView.split("\n");
    const confirmationTitleIndex = confirmationLines.findIndex((line) =>
      line.includes("Close subagent?"),
    );
    const confirmationHintIndex = confirmationLines.findIndex((line) =>
      line.includes("↑↓ navigate"),
    );
    const timerLine = confirmationLines.find((line) =>
      /\d{2}:\d{2}:\d{2}/.test(line),
    );
    const borderAccent = "\u001B[38;2;0;215;255m─";
    harness.assert(
      confirmationTitleIndex >= 2 &&
        confirmationLines[confirmationTitleIndex - 1]?.trim() === "" &&
        /^─+$/.test(
          confirmationLines[confirmationTitleIndex - 2]?.trim() ?? "",
        ) &&
        confirmationHintIndex > confirmationTitleIndex &&
        confirmationLines[confirmationHintIndex + 1]?.trim() === "" &&
        /^─+$/.test(
          confirmationLines[confirmationHintIndex + 2]?.trim() ?? "",
        ) &&
        confirmationLines[confirmationTitleIndex]?.indexOf(
          "Close subagent?",
        ) === 3 &&
        timerLine?.search(/\d{2}:\d{2}:\d{2}/) === 3 &&
        confirmationOutput.split(borderAccent).length - 1 >= 2,
      "Close confirmation did not match the aligned accent-border UI.",
    );

    await harness.sendParentKeys("Escape");
    let cancelledConfirmationView = "";
    await harness.waitUntil(
      "cancelled confirmation to return to widget navigation",
      async () => {
        cancelledConfirmationView = await harness.capture();
        return (
          cancelledConfirmationView.includes("d close") &&
          !cancelledConfirmationView.includes("Close subagent?")
        );
      },
      5_000,
    );
    harness.assert(
      cancelledConfirmationView.includes("›"),
      "Cancelling close confirmation did not return focus to the widget.",
    );

    await harness.sendParent("d");
    await harness.waitFor("Close subagent?", 5_000);
    await harness.sendParentKeys("Down", "Enter");
    let declinedConfirmationView = "";
    await harness.waitUntil(
      "declined confirmation to return to widget navigation",
      async () => {
        declinedConfirmationView = await harness.capture();
        return (
          declinedConfirmationView.includes("d close") &&
          !declinedConfirmationView.includes("Close subagent?")
        );
      },
      5_000,
    );
    harness.assert(
      declinedConfirmationView.includes("›"),
      "Selecting No did not return focus to the widget.",
    );

    await Bun.sleep(500);

    const surviving = (
      await harness.tmux("display-message", "-p", "-t", childPane, "#{pane_id}")
    ).trim();

    harness.assert(
      surviving === childPane,
      "Cancelling close confirmation removed the child pane.",
    );

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

    await harness.waitUntil(
      "navigation to close after deleting the final live child",
      async () => {
        const emptyNavigationView = await harness.capture();
        return (
          !emptyNavigationView.includes("d close") &&
          !emptyNavigationView.includes("›")
        );
      },
      5_000,
    );
  },
};
