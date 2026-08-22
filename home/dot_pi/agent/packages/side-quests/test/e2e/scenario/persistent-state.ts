import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import { assertManagedStorage } from "../persistent-state-storage.ts";
import { sessionPath } from "../provider-support.ts";

export const persistentState: Scenario = {
  name: "persistent-state",
  process: {
    lifecycle: "interactive",
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
  },
  timeoutMs: 45_000,
  configureProvider({ faux, role }) {
    if (role === "child") {
      return faux.setResponses([
        fauxAssistantMessage(
          fauxToolCall("ask_parent", {
            prompt: "Which persistence value should I use?",
          }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage(fauxText("Persistence request remains pending.")),
        fauxAssistantMessage(fauxText("Persistence response applied.")),
      ]);
    }

    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("Agent", {
          description: "E2E delegated task",
          prompt:
            "Persist managed state, then ask the parent which persistence value to use.",
          interactive: true,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("The delegated work is in progress.")),
      (context: { messages: unknown }) => {
        const resume = sessionPath(
          context.messages,
          /Resume:\s*([^"\n]+session\.jsonl)/,
        );
        return resume
          ? fauxAssistantMessage(
              fauxToolCall("Agent", {
                description: "Answer the E2E child question",
                prompt: "Use durable-state.",
                resume,
              }),
              { stopReason: "toolUse" },
            )
          : fauxAssistantMessage("Missing managed resume path.", {
              stopReason: "error",
              errorMessage: "Missing managed resume path.",
            });
      },
      fauxAssistantMessage(
        fauxText("The parent persisted the child response."),
      ),
    ]);
  },
  async run(harness: E2EHarness) {
    const childPane = await harness.childPane();

    await harness.waitUntil(
      "the storage child to persist its parent request",
      () => harness.filesNamed("request.json").length === 1,
    );

    const childPidText = (
      await harness.tmux(
        "display-message",
        "-p",
        "-t",
        childPane,
        "#{pane_pid}",
      )
    ).trim();

    const childPid = Number.parseInt(childPidText, 10);

    harness.assert(
      Number.isInteger(childPid),
      "Managed child pane did not identify its process.",
    );

    process.kill(childPid, "SIGSTOP");

    try {
      await harness.waitFor("Which persistence value should I use?");
      await harness.waitUntil(
        "the parent response to persist while the child is paused",
        () => harness.filesNamed("response.json").length === 1,
      );

      assertManagedStorage("response", harness.stateDirectory, childPane);
    } finally {
      process.kill(childPid, "SIGCONT");
    }

    await harness.waitForStoredText("Persistence response applied.");
    await harness.sendLiteral(childPane, "/subagent-done", true);
    await harness.waitFor("Subagent completed:");

    assertManagedStorage("terminal", harness.stateDirectory, childPane);
  },
};
