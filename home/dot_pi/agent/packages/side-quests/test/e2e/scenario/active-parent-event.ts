import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import { fauxSubagentDone } from "../provider-support.ts";

const expected = "Active parent received child event before next model call.";
const missed = "Active parent missed child event before next model call.";

export const activeParentEvent: Scenario = {
  name: "active-parent-event",
  process: {
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
  },
  timeoutMs: 45_000,
  configureProvider({ faux, role }) {
    if (role === "child") {
      faux.setResponses([
        fauxAssistantMessage(
          fauxToolCall("ask_parent", {
            prompt: "Can you see this before your next model call?",
          }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage(fauxText("The child remains available.")),
        fauxSubagentDone("The child remains available."),
      ]);
      return;
    }

    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("Agent", {
            description: "Active parent event E2E",
            prompt: "Ask the parent the timing question, then remain open.",
            interactive: true,
          }),
          fauxToolCall("bash", { command: "sleep 6" }),
        ],
        { stopReason: "toolUse" },
      ),
      (context: { messages: unknown }) =>
        fauxAssistantMessage(
          fauxText(
            JSON.stringify(context.messages).includes(
              "Subagent asks: Can you see this before your next model call?",
            )
              ? expected
              : missed,
          ),
        ),
      fauxAssistantMessage(fauxText("The later child event was processed.")),
    ]);
  },
  async run(harness: E2EHarness) {
    const childPane = await harness.childPane();
    const view = await harness.waitFor(
      /Active parent (?:received|missed) child event before next model call\./,
      20_000,
    );
    harness.assert(
      view.includes(expected),
      "The child event waited until the active parent agent fully settled.",
    );

    await harness.sendLiteral(childPane, "/subagent-done", true);
    await harness.waitFor("SUBAGENT COMPLETED");
  },
};
