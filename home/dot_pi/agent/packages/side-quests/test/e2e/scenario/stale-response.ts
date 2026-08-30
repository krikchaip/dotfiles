import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import { delay, fauxSubagentDone, sessionPath } from "../provider-support.ts";

export const staleResponse: Scenario = {
  name: "stale-response",
  process: {
    lifecycle: "interactive",
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
  },
  configureProvider({ faux, role }) {
    if (role === "child") {
      return faux.setResponses([
        fauxAssistantMessage(fauxText("Old successful response.")),
        fauxAssistantMessage("Synthetic resumed child failure.", {
          stopReason: "error",
          errorMessage: "Synthetic resumed child failure.",
        }),
        fauxSubagentDone("Current interactive handoff."),
      ]);
    }
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("Agent", {
          description: "E2E delegated task",
          prompt: "Produce the old response before stale response E2E.",
          interactive: true,
        }),
        { stopReason: "toolUse" },
      ),
      async (providerContext: { messages: unknown }) => {
        await delay(1_500);
        const path = sessionPath(
          providerContext.messages,
          /Subagent launched\. Session: ([^"\n]+session\.jsonl)/,
        );
        return path
          ? fauxAssistantMessage(
              fauxToolCall("Agent", {
                description: "Continue the E2E delegated task",
                prompt: "Run the failing continuation without stale output.",
                resume: path,
              }),
              { stopReason: "toolUse" },
            )
          : fauxAssistantMessage("Missing launched session path.", {
              stopReason: "error",
              errorMessage: "Missing launched session path.",
            });
      },
      fauxAssistantMessage(fauxText("The delegated continuation was sent.")),
    ]);
  },
  async run(harness: E2EHarness) {
    await harness.waitFor(
      "Agent general-purpose (steered) :: Continue the E2E delegated task",
    );
    const childPane = await harness.childPane();

    await harness.waitForStoredText("Synthetic resumed child failure.");
    const child = await harness.capture(childPane);

    harness.assert(
      child.includes("Synthetic resumed child failure."),
      "The interactive provider failure was not visible in the child pane.",
    );

    const live = (
      await harness.tmux("display-message", "-p", "-t", childPane, "#{pane_id}")
    ).trim();

    harness.assert(
      live === childPane,
      "The interactive provider failure closed the child pane.",
    );

    await harness.sendParent("/side-quests", true);
    await harness.waitFor("waiting", 5_000);

    const parent = await harness.capture();

    harness.assert(
      parent.includes("Side Quests · 1 live"),
      `The interactive provider failure removed its live widget row.\n${parent}`,
    );
    harness.assert(
      !parent.includes("SUBAGENT FAILED"),
      "The interactive provider failure sent a terminal result to the parent.",
    );
    harness.assert(
      harness.filesNamed("terminal.json").length === 0,
      "The interactive provider failure persisted a terminal record.",
    );

    await harness.sendParentKeys("Escape");
    await harness.sendLiteral(childPane, "/subagent-done", true);
    await harness.waitFor("SUBAGENT COMPLETED");

    const terminals = harness.filesNamed("terminal.json");
    harness.assert(
      terminals.length === 1,
      "The stale-response run did not retain one terminal record.",
    );

    const terminal = harness.read(terminals[0]);
    harness.assert(
      !terminal.includes("Old successful response.") &&
        terminal.includes('"response":"Current interactive handoff."'),
      "The explicit completion reused a stale assistant response.",
    );
  },
};
