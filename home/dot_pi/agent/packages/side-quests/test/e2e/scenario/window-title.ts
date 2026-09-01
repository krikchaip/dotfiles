import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

const FIRST_DESCRIPTION = "Focused title E2E";
const SECOND_DESCRIPTION = "Detached title E2E";
const CONTINUED_DESCRIPTION = "Continued title E2E";
const REOPENED_DESCRIPTION = "Reopened title E2E";
const CHILD_READY = "Window-title child is ready.";

export const windowTitle: Scenario = {
  name: "window-title",
  exclusive: true,
  process: {
    lifecycle: "interactive",
    managed: true,
    positionalPrompt: "Delegate the first window-title E2E task now.",
  },
  timeoutMs: 45_000,
  configureProvider({ faux, role }) {
    if (role === "child") {
      faux.setResponses([
        fauxAssistantMessage(fauxText(CHILD_READY)),
        fauxAssistantMessage(fauxText("Window-title continuation received.")),
        fauxAssistantMessage(fauxText("Window-title child reopened.")),
      ]);
      return;
    }

    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("Agent", {
          description: FIRST_DESCRIPTION,
          interactive: true,
          prompt: "Stay open as the first window-title child.",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("First window-title child is open.")),
      fauxAssistantMessage(
        fauxToolCall("Agent", {
          description: SECOND_DESCRIPTION,
          interactive: true,
          prompt: "Stay open as the second window-title child.",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("Second window-title child is open.")),
      (context: { messages: unknown }) => {
        const paths = [
          ...JSON.stringify(context.messages).matchAll(
            /Subagent launched\. Session: ([^"\n]+session\.jsonl)/g,
          ),
        ];
        const resume = paths.at(-1)?.[1];

        return resume
          ? fauxAssistantMessage(
              fauxToolCall("Agent", {
                description: CONTINUED_DESCRIPTION,
                prompt: "Apply the selected-child title continuation.",
                resume,
              }),
              { stopReason: "toolUse" },
            )
          : fauxAssistantMessage("Missing second child session path.", {
              stopReason: "error",
              errorMessage: "Missing second child session path.",
            });
      },
      fauxAssistantMessage(fauxText("Window-title continuation sent.")),
      fauxAssistantMessage(fauxText("Selected child closure observed.")),
      (context: { messages: unknown }) => {
        const paths = [
          ...JSON.stringify(context.messages).matchAll(
            /Subagent launched\. Session: ([^"\n]+session\.jsonl)/g,
          ),
        ];
        const resume = paths.at(-1)?.[1];

        return resume
          ? fauxAssistantMessage(
              fauxToolCall("Agent", {
                description: REOPENED_DESCRIPTION,
                prompt: "Reopen without changing the selected pane title.",
                resume,
              }),
              { stopReason: "toolUse" },
            )
          : fauxAssistantMessage("Missing closed child session path.", {
              stopReason: "error",
              errorMessage: "Missing closed child session path.",
            });
      },
      fauxAssistantMessage(fauxText("Detached reopen sent.")),
      fauxAssistantMessage(fauxText("Direct pane closure observed.")),
      fauxAssistantMessage(
        fauxToolCall("Agent", {
          description: "Post-override title E2E",
          interactive: true,
          prompt: "Stay open after the user title override.",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("Post-override child is open.")),
    ]);
  },
  async run(harness: E2EHarness) {
    const firstPane = await harness.childPane();
    await harness.waitFor(CHILD_READY, 10_000, firstPane);

    const firstTitle = (
      await harness.tmux(
        "display-message",
        "-p",
        "-t",
        firstPane,
        "#{window_name}",
      )
    ).trim();
    harness.assert(
      firstTitle === FIRST_DESCRIPTION,
      `First child title mismatch: expected ${JSON.stringify(FIRST_DESCRIPTION)}, got ${JSON.stringify(firstTitle)}.`,
    );

    await harness.sendParent("Launch the second window-title child.", true);
    let secondPane = "";
    await harness.waitUntil("two managed window-title panes", async () => {
      const panes = await harness.childPanes();
      secondPane = panes.find((pane) => pane !== firstPane) ?? "";
      return panes.length === 2 && !!secondPane;
    });
    await harness.waitFor(CHILD_READY, 10_000, secondPane);

    const detachedTitle = (
      await harness.tmux(
        "display-message",
        "-p",
        "-t",
        firstPane,
        "#{window_name}",
      )
    ).trim();
    harness.assert(
      detachedTitle === FIRST_DESCRIPTION,
      `Detached launch replaced the selected title: ${JSON.stringify(detachedTitle)}.`,
    );

    await harness.sendParentKeys("S-Up");
    await harness.waitFor("d close", 5_000);
    await harness.sendParentKeys("Down", "Enter");
    await harness.waitUntil(
      "Side Quests navigation to update the selected child title immediately",
      async () =>
        (
          await harness.tmux(
            "display-message",
            "-p",
            "-t",
            secondPane,
            "#{window_name}",
          )
        ).trim() === SECOND_DESCRIPTION,
      600,
    );
    await harness.sendLiteral(secondPane, "\u001B[1;2A");
    await harness.waitUntil(
      "window-title child to return focus to the parent",
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
      3_000,
    );
    await harness.sendParentKeys("Escape");
    await harness.waitUntil(
      "window-title navigation to close",
      async () => !(await harness.capture()).includes("d close"),
      3_000,
    );

    await harness.tmux("select-pane", "-t", firstPane);
    await harness.waitUntil(
      "direct tmux focus to update the first child title",
      async () =>
        (
          await harness.tmux(
            "display-message",
            "-p",
            "-t",
            firstPane,
            "#{window_name}",
          )
        ).trim() === FIRST_DESCRIPTION,
      1_600,
    );
    await harness.tmux("select-pane", "-t", secondPane);
    await harness.waitUntil(
      "direct tmux focus to update the second child title",
      async () =>
        (
          await harness.tmux(
            "display-message",
            "-p",
            "-t",
            secondPane,
            "#{window_name}",
          )
        ).trim() === SECOND_DESCRIPTION,
      1_600,
    );

    await Bun.sleep(50);
    await harness.sendParent("Continue the selected window-title child.", true);
    await harness.waitUntil(
      "selected continuation to update the title immediately",
      async () =>
        (
          await harness.tmux(
            "display-message",
            "-p",
            "-t",
            secondPane,
            "#{window_name}",
          )
        ).trim() === CONTINUED_DESCRIPTION,
      600,
    );

    await harness.sendParentKeys("S-Up");
    await harness.waitFor("d close", 5_000);
    await harness.sendParentKeys("Down");
    await harness.waitUntil(
      "navigation to select the continued child for closure",
      async () =>
        (await harness.capture())
          .split("\n")
          .some(
            (line) =>
              line.includes("›") && line.includes(CONTINUED_DESCRIPTION),
          ),
      5_000,
    );
    await harness.sendParent("d");
    await harness.waitFor("Close subagent?", 5_000);
    await harness.sendParentKeys("Enter");
    await harness.waitUntil(
      "selected child closure to leave one managed pane",
      async () => (await harness.childPanes()).length === 1,
      5_000,
    );
    await harness.waitUntil(
      "selected child closure to update the title",
      async () =>
        (
          await harness.tmux(
            "display-message",
            "-p",
            "-t",
            firstPane,
            "#{window_name}",
          )
        ).trim() === FIRST_DESCRIPTION,
      1_600,
    );
    await harness.waitFor("Selected child closure observed.", 5_000);
    await harness.sendParentKeys("Escape");
    await harness.waitUntil(
      "window-title navigation to close after child closure",
      async () => !(await harness.capture()).includes("d close"),
      3_000,
    );

    await harness.sendParent("Reopen the closed window-title child.", true);
    let reopenedPane = "";
    await harness.waitUntil("detached reopened child pane", async () => {
      const panes = await harness.childPanes();
      reopenedPane = panes.find((pane) => pane !== firstPane) ?? "";
      return panes.length === 2 && !!reopenedPane;
    });
    await Bun.sleep(1_100);
    const detachedReopenTitle = (
      await harness.tmux(
        "display-message",
        "-p",
        "-t",
        firstPane,
        "#{window_name}",
      )
    ).trim();
    harness.assert(
      detachedReopenTitle === FIRST_DESCRIPTION,
      `Detached reopen replaced the selected title: ${JSON.stringify(detachedReopenTitle)}.`,
    );

    await harness.tmux("select-pane", "-t", reopenedPane);
    await harness.waitUntil(
      "direct focus to update the reopened child title",
      async () =>
        (
          await harness.tmux(
            "display-message",
            "-p",
            "-t",
            reopenedPane,
            "#{window_name}",
          )
        ).trim() === REOPENED_DESCRIPTION,
      1_600,
    );
    await harness.tmux("kill-pane", "-t", reopenedPane);
    await harness.waitUntil(
      "direct selected-pane closure to update the surviving title",
      async () =>
        (await harness.childPanes()).length === 1 &&
        (
          await harness.tmux(
            "display-message",
            "-p",
            "-t",
            firstPane,
            "#{window_name}",
          )
        ).trim() === FIRST_DESCRIPTION,
      1_600,
    );
    await harness.waitFor("Direct pane closure observed.", 5_000);

    const unmanagedPane = (
      await harness.tmux(
        "split-window",
        "-P",
        "-F",
        "#{pane_id}",
        "-t",
        firstPane,
        "/usr/bin/tail",
        "-f",
        "/dev/null",
      )
    ).trim();
    await harness.waitUntil(
      "unmanaged pane focus to restore tmux's native title",
      async () =>
        (
          await harness.tmux(
            "display-message",
            "-p",
            "-t",
            unmanagedPane,
            "#{window_name}",
          )
        ).trim() === "tail",
      3_000,
    );

    const manualTitle = "My manual Side Quests title";
    await harness.tmux("rename-window", "-t", unmanagedPane, manualTitle);
    await harness.tmux("select-pane", "-t", firstPane);
    await Bun.sleep(1_500);
    const preservedTitle = (
      await harness.tmux(
        "display-message",
        "-p",
        "-t",
        firstPane,
        "#{window_name}",
      )
    ).trim();
    harness.assert(
      preservedTitle === manualTitle,
      `Managed focus replaced a user-owned title: ${JSON.stringify(preservedTitle)}.`,
    );

    await harness.sendParent("Launch after the manual title override.", true);
    await harness.waitUntil(
      "two managed children after the title override",
      async () => (await harness.childPanes()).length === 2,
    );
    const afterLaunch = (
      await harness.tmux(
        "display-message",
        "-p",
        "-t",
        firstPane,
        "#{window_name}\t#{@side_quests_title_owner}",
      )
    ).trim();
    harness.assert(
      afterLaunch === `${manualTitle}\tuser`,
      `Detached launch changed user-owned title state: ${JSON.stringify(afterLaunch)}.`,
    );

    await harness.sendParent("/reload", true);
    await Bun.sleep(1_500);
    const afterReload = (
      await harness.tmux(
        "display-message",
        "-p",
        "-t",
        firstPane,
        "#{window_name}\t#{@side_quests_title_owner}",
      )
    ).trim();
    harness.assert(
      afterReload === `${manualTitle}\tuser`,
      `Parent reload changed user-owned title state: ${JSON.stringify(afterReload)}.`,
    );
  },
};
