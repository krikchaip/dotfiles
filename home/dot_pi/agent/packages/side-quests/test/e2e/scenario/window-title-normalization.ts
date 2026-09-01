import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import { fauxSubagentDone } from "../provider-support.ts";

const RAW_DESCRIPTION = `Focus\t\t#{} \u001B[31m紅\u001B[0m ${"界".repeat(30)}`;
const NORMALIZED_TITLE = `Focus #{} 紅 ${"界".repeat(17)}`;
const EMPTY_DESCRIPTION = "\u001B[31m\u001B[0m";
const NATIVE_DESCRIPTION = "native";
const SEMICOLON_DESCRIPTION = ";";
const CHILD_READY = "Normalization child is ready.";

export const windowTitleNormalization: Scenario = {
  name: "window-title-normalization",
  process: {
    lifecycle: "interactive",
    managed: true,
    positionalPrompt: "Launch the title-normalization child.",
  },
  timeoutMs: 45_000,
  configureProvider({ faux, role }) {
    if (role === "child") {
      faux.setResponses([
        fauxAssistantMessage(fauxText(CHILD_READY)),
        fauxSubagentDone("Normalization child closed."),
      ]);
      return;
    }

    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("Agent", {
          description: RAW_DESCRIPTION,
          interactive: true,
          prompt: "Stay open for title normalization.",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("Normalization child is open.")),
      fauxAssistantMessage(
        fauxToolCall("Agent", {
          description: EMPTY_DESCRIPTION,
          interactive: true,
          prompt: "Stay open for the empty-title fallback.",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("Fallback child is open.")),
      fauxAssistantMessage(
        fauxToolCall("Agent", {
          description: NATIVE_DESCRIPTION,
          interactive: true,
          prompt: "Stay open for the native-title collision check.",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("Native-title child is open.")),
      fauxAssistantMessage(
        fauxToolCall("Agent", {
          description: SEMICOLON_DESCRIPTION,
          interactive: true,
          prompt: "Stay open for the semicolon-title literal check.",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("Semicolon-title child is open.")),
    ]);
  },
  async run(harness: E2EHarness) {
    const normalizedPane = await harness.childPane();
    await harness.waitFor(CHILD_READY, 10_000, normalizedPane);

    const normalizedTitle = (
      await harness.tmux(
        "display-message",
        "-p",
        "-t",
        normalizedPane,
        "#{window_name}",
      )
    ).trim();
    harness.assert(
      normalizedTitle === NORMALIZED_TITLE,
      `Normalized title mismatch: expected ${JSON.stringify(NORMALIZED_TITLE)}, got ${JSON.stringify(normalizedTitle)}.`,
    );

    await harness.sendParent("Launch the fallback child.", true);
    let fallbackPane = "";
    await harness.waitUntil("two normalization panes", async () => {
      const panes = await harness.childPanes();
      fallbackPane = panes.find((pane) => pane !== normalizedPane) ?? "";
      return panes.length === 2 && !!fallbackPane;
    });
    await harness.waitFor(CHILD_READY, 10_000, fallbackPane);
    await harness.tmux("select-pane", "-t", fallbackPane);
    await harness.waitUntil(
      "empty normalized title to use the fallback",
      async () =>
        (
          await harness.tmux(
            "display-message",
            "-p",
            "-t",
            fallbackPane,
            "#{window_name}",
          )
        ).trim() === "Side Quests",
      3_000,
    );

    await harness.sendParent("Launch the native-title child.", true);
    let nativePane = "";
    await harness.waitUntil("three normalization panes", async () => {
      const panes = await harness.childPanes();
      nativePane =
        panes.find(
          (pane) => pane !== normalizedPane && pane !== fallbackPane,
        ) ?? "";
      return panes.length === 3 && !!nativePane;
    });
    await harness.waitFor(CHILD_READY, 10_000, nativePane);
    await harness.tmux("select-pane", "-t", nativePane);
    await Bun.sleep(1_100);
    await harness.waitUntil(
      "native description to remain a managed literal after one poll",
      async () =>
        (
          await harness.tmux(
            "display-message",
            "-p",
            "-t",
            nativePane,
            "#{window_name}",
          )
        ).trim() === NATIVE_DESCRIPTION,
      3_000,
    );
    await harness.tmux("select-pane", "-t", normalizedPane);
    await harness.waitUntil(
      "focus after native description to stay Side Quests-owned",
      async () =>
        (
          await harness.tmux(
            "display-message",
            "-p",
            "-t",
            normalizedPane,
            "#{window_name}",
          )
        ).trim() === NORMALIZED_TITLE,
      3_000,
    );

    await harness.sendParent("Launch the semicolon-title child.", true);
    let semicolonPane = "";
    await harness.waitUntil("four normalization panes", async () => {
      const panes = await harness.childPanes();
      semicolonPane =
        panes.find(
          (pane) =>
            pane !== normalizedPane &&
            pane !== fallbackPane &&
            pane !== nativePane,
        ) ?? "";
      return panes.length === 4 && !!semicolonPane;
    });
    await harness.waitFor(CHILD_READY, 10_000, semicolonPane);
    await harness.tmux("select-pane", "-t", semicolonPane);
    await harness.waitUntil(
      "semicolon description to render as a literal title",
      async () =>
        (
          await harness.tmux(
            "display-message",
            "-p",
            "-t",
            semicolonPane,
            "#{window_name}",
          )
        ).trim() === SEMICOLON_DESCRIPTION,
      3_000,
    );

    for (const pane of [
      normalizedPane,
      fallbackPane,
      nativePane,
      semicolonPane,
    ])
      await harness.sendLiteral(pane, "/subagent-done", true);
    await harness.waitUntil(
      "normalization children to close",
      async () => (await harness.childPanes()).length === 0,
      10_000,
    );
  },
};
