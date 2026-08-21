import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import { sessionPath } from "../provider-support.ts";

const positionalPrompt = "Delegate this E2E task now.";

export const askParent: Scenario = {
  name: "ask-parent",
  process: {
    lifecycle: "interactive",
    managed: true,
    positionalPrompt,
  },
  timeoutMs: 45_000,
  configureProvider({ faux, role }) {
    if (role === "child") {
      return faux.setResponses([
        (context: { systemPrompt?: string }) =>
          context.systemPrompt?.includes(
            "- ask_parent: Send a question to the parent agent without pausing the side quest",
          ) &&
          context.systemPrompt?.includes(
            "- You are a sub-agent executing an assigned side quest. The parent agent owns the main quest and delegates side quests.",
          ) &&
          context.systemPrompt?.includes(
            "- Use ask_parent when your assigned side quest needs information or a decision from the parent agent.",
          ) &&
          context.systemPrompt?.includes(
            "- After calling ask_parent, you may continue the assigned side quest without waiting for a reply.",
          ) &&
          context.systemPrompt?.includes(
            "- Call ask_parent again only after the parent response arrives as a continuation message.",
          )
            ? fauxAssistantMessage(
                [
                  fauxToolCall("ask_parent", {
                    prompt: "Which color should I use?",
                  }),
                  fauxToolCall("ask_parent", {
                    prompt: "Can I ask a second question now?",
                  }),
                ],
                { stopReason: "toolUse" },
              )
            : fauxAssistantMessage(
                "ask_parent is missing from Available tools.",
                {
                  stopReason: "error",
                  errorMessage: "ask_parent is missing from Available tools.",
                },
              ),
        fauxAssistantMessage(
          fauxText("I continued while the reply was pending."),
        ),
        fauxAssistantMessage(fauxText("Parent answer applied: blue.")),
      ]);
    }

    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("Agent", {
          description: "E2E delegated task",
          prompt: "Ask parent which color to use, then apply the answer.",
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
                prompt: "Use blue.",
                resume,
              }),
              { stopReason: "toolUse" },
            )
          : fauxAssistantMessage("Missing managed resume path.", {
              stopReason: "error",
              errorMessage: "Missing managed resume path.",
            });
      },
      fauxAssistantMessage(fauxText("The parent answered the child.")),
    ]);
  },
  async run(harness: E2EHarness) {
    const childPane = await harness.childPane();
    const error = "A parent question is already pending for this subagent.";

    await harness.waitFor("Subagent asks: Which color should I use?");
    await harness.waitFor(error, 5_000, childPane);

    const collapsed = await harness.capture(childPane);
    const collapsedError = collapsed
      .split("\n")
      .find((line) => line.includes(error));
    harness.assert(
      collapsedError !== undefined && !collapsedError.includes("to expand"),
      "The collapsed ask_parent error showed a redundant expansion hint.",
    );

    await harness.sendKeys(childPane, "C-o");
    const expanded = await harness.capture(childPane);
    const expandedError = expanded
      .split("\n")
      .find((line) => line.includes(error));
    harness.assert(
      expandedError?.trim() === collapsedError.trim(),
      "Expanding changed the ask_parent error message.",
    );

    await harness.waitForStoredText("Parent answer applied: blue.");
    await harness.sendLiteral(childPane, "/subagent-done", true);
    await harness.waitFor("Subagent completed:");
  },
};
