import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

const pendingQuestion =
  "Should the closed outcome retain this unanswered question after the child tmux pane disappears? Confirm that the parent transcript keeps the pending-request warning, uses Unicode-safe truncation at 240 characters, restores the complete question in expanded mode, and preserves the durable request mailbox so a resumed side quest can still receive the answer. Closed pending marker.";

export const pendingRequestClosure: Scenario = {
  name: "pending-request-closure",
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
            prompt: pendingQuestion,
          }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage(fauxText("The parent request remains pending.")),
      ]);
    }

    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("Agent", {
          description: "E2E delegated task",
          prompt: "Ask the pending closure question, then remain open.",
          interactive: true,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("The delegated work is in progress.")),
      fauxAssistantMessage(fauxText("The question remains unanswered.")),
      fauxAssistantMessage(fauxText("The child closed with a saved request.")),
    ]);
  },
  async run(harness: E2EHarness) {
    const childPane = await harness.childPane();
    let requestFile = "";

    await harness.waitUntil("one unanswered parent request", () => {
      const requests = harness.filesNamed("request.json");
      requestFile = requests.length === 1 ? (requests[0] ?? "") : "";
      return !!requestFile;
    });

    harness.assert(
      harness.read(requestFile).includes(pendingQuestion),
      "The saved parent request did not contain the child question.",
    );

    await harness.waitFor("Should the closed outcome retain");
    await harness.tmux("kill-pane", "-t", childPane);
    await harness.waitFor("SUBAGENT CLOSED");

    const collapsed = await harness.capture();

    harness.assert(
      collapsed.includes("PENDING QUESTION"),
      `The closed result did not label its pending question.\n${collapsed}`,
    );
    harness.assert(
      collapsed.includes("to expand"),
      `The closed result did not truncate its pending question.\n${collapsed}`,
    );
    harness.assert(
      !collapsed.includes("pending marker."),
      `The closed result showed the complete question while collapsed.\n${collapsed}`,
    );

    await harness.sendParentKeys("C-o");
    await harness.waitFor("pending marker.", 5_000);
    await harness.waitFor("session path:", 5_000);

    harness.assert(
      existsSync(requestFile),
      "The unanswered parent request was removed after child closure.",
    );

    harness.assert(
      !existsSync(join(dirname(requestFile), "response.json")),
      "A response mailbox exists although the parent did not answer.",
    );
  },
};
