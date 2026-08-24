import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import { delay } from "../provider-support.ts";

const question =
  "Should inherited child sessions use the approved question banner?";
const sourceDescription = "Inherited question source";
const viewerDescription = "Inherited question viewer";

export const inheritedParentRequestRenderer: Scenario = {
  name: "inherited-parent-request-renderer",
  process: {
    managed: true,
    persistSession: true,
    positionalPrompt: "Create the inherited parent-request renderer fixture.",
  },
  timeoutMs: 45_000,
  configureProvider({ faux, initialPrompt, role }) {
    if (role === "child") {
      if (initialPrompt.includes("Ask the renderer question")) {
        faux.setResponses([
          fauxAssistantMessage(
            fauxToolCall("ask_parent", { prompt: question }),
            { stopReason: "toolUse" },
          ),
          fauxAssistantMessage(fauxText("The source child sent its question.")),
        ]);
        return;
      }

      faux.setResponses([
        fauxAssistantMessage(
          fauxText("The viewer child loaded its inherited context."),
        ),
      ]);
      return;
    }

    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("Agent", {
            description: sourceDescription,
            prompt: "Ask the renderer question, then remain available.",
            interactive: true,
          }),
          fauxToolCall("bash", { command: "sleep 3" }),
        ],
        { stopReason: "toolUse" },
      ),
      (context: { messages: unknown }) => {
        const inheritedRequest = JSON.stringify(context.messages).includes(
          `Subagent asks: ${question}`,
        );

        return inheritedRequest
          ? fauxAssistantMessage(
              fauxToolCall("Agent", {
                description: viewerDescription,
                prompt:
                  "Inspect the inherited question, then remain available.",
                inherit_context: true,
                interactive: true,
              }),
              { stopReason: "toolUse" },
            )
          : fauxAssistantMessage("The parent request was not inherited.", {
              stopReason: "error",
              errorMessage: "The parent request was not inherited.",
            });
      },
      fauxAssistantMessage(fauxText("Both renderer children are available.")),
    ]);
  },
  async run(harness: E2EHarness) {
    await harness.waitFor(question, 20_000);

    let viewerPane = "";
    await harness.waitUntil(
      "the inherited question viewer pane",
      async () => {
        for (const pane of await harness.childPanes()) {
          const view = await harness.capture(pane);
          if (view.includes(viewerDescription)) {
            viewerPane = pane;
            return true;
          }
        }
        return false;
      },
      20_000,
    );

    await delay(500);
    const view = await harness.capture(viewerPane);

    harness.assert(
      view.includes("SUBAGENT ASKS") && view.includes(question),
      `The inherited parent request used the legacy child-session UI.\n${view}`,
    );
    harness.assert(
      !view.includes("[side-quest-result]"),
      `The inherited parent request exposed its custom message type.\n${view}`,
    );

    for (const pane of await harness.childPanes())
      await harness.sendLiteral(pane, "/subagent-done", true);

    await harness.waitFor("SUBAGENT COMPLETED");
  },
};
