import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import { fauxSubagentDone, sessionPath } from "../provider-support.ts";

const positionalPrompt = "Delegate this E2E task now.";
const parentQuestion =
  "Before I update the renderer, should I preserve every explicit field label from the old transcript, or should I use the selected identity-first layout for all new questions? The choice affects narrow terminals, existing saved sessions, Unicode wrapping, continuation prompts, and how quickly the parent can find the decision that blocks the subagent. Please choose the compatibility rule that should be canonical.";

export const askParent: Scenario = {
  name: "ask-parent",
  process: {
    lifecycle: "interactive",
    managed: true,
    positionalPrompt,
    providerTokensPerSecond: 20,
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
                    prompt: parentQuestion,
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
        fauxSubagentDone("Parent answer applied: blue."),
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

    await harness.waitFor("SUBAGENT ASKS");
    await harness.waitFor("general-purpose");
    await harness.waitFor("E2E delegated task");
    await harness.waitFor("Before I update the renderer");
    await harness.waitFor(
      "Agent general-purpose (answered) :: Answer the E2E child question",
    );

    const terminalLog = harness.read(harness.logPath);
    harness.assert(
      !terminalLog.includes(
        "Agent general-purpose (resumed) :: Answer the E2E child question",
      ),
      "The parent answer briefly rendered as resumed before answered.",
    );

    const collapsedParent = await harness.capture();
    harness.assert(
      !collapsedParent.includes("session path:"),
      "The collapsed subagent question exposed its session path.",
    );
    harness.assert(
      collapsedParent.includes("to expand"),
      "The truncated subagent question omitted its expansion hint.",
    );

    const styledCollapsedParent = harness.read(harness.logPath);
    const questionStartWithStyle = styledCollapsedParent.lastIndexOf(
      "Before I update the renderer",
    );
    const hintText = styledCollapsedParent.indexOf(
      "to expand",
      questionStartWithStyle,
    );
    const ellipsis = styledCollapsedParent.lastIndexOf("…", hintText);
    const key = collapsedParent.match(/… (\S+) to expand/)?.[1] ?? "";
    const keyStart = styledCollapsedParent.indexOf(key, ellipsis);
    const activeStyleAt = (index: number) => {
      const styleStart = styledCollapsedParent.lastIndexOf("\u001B[", index);
      const styleEnd = styledCollapsedParent.indexOf("m", styleStart);
      return styledCollapsedParent.slice(styleStart, styleEnd + 1);
    };
    harness.assert(
      questionStartWithStyle >= 0 &&
        ellipsis >= 0 &&
        key.length > 0 &&
        keyStart >= 0 &&
        hintText >= 0,
      "The styled subagent-question hint could not be located.",
    );
    const hintStyle = activeStyleAt(ellipsis);
    harness.assert(
      activeStyleAt(hintText) === hintStyle,
      "The ellipsis and non-key hint text did not use one muted style.",
    );
    harness.assert(
      activeStyleAt(keyStart) !== hintStyle,
      "The expansion key did not use its separate dim style.",
    );

    await harness.sendParentKeys("C-o");
    await harness.waitFor("session path:");
    const expandedParent = await harness.capture();
    const questionStart = expandedParent.indexOf("SUBAGENT ASKS");
    const nextAgentCall = expandedParent.indexOf(
      "Answer the E2E child question",
      questionStart,
    );
    const expandedQuestionBanner = expandedParent.slice(
      Math.max(0, questionStart),
      nextAgentCall >= 0 ? nextAgentCall : undefined,
    );
    harness.assert(
      expandedQuestionBanner.includes("canonical."),
      "The expanded subagent question omitted its complete text.",
    );
    harness.assert(
      !expandedQuestionBanner.includes("to expand"),
      "The expanded subagent question retained its expansion hint.",
    );
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
    await harness.waitUntil(
      "child ask_parent output to be expanded",
      async () => {
        const view = await harness.capture(childPane);
        return (
          view.lastIndexOf("Tool output: expanded") >
          view.lastIndexOf("Tool output: collapsed")
        );
      },
    );
    const expanded = await harness.capture(childPane);
    const expandedError = expanded
      .split("\n")
      .find((line) => line.includes(error));
    harness.assert(
      expandedError !== undefined && !expandedError.includes("to expand"),
      "The expanded ask_parent error changed or gained an expansion hint.",
    );

    await harness.waitForStoredText("Parent answer applied: blue.");
    await harness.waitFor("FROM PARENT", 5_000, childPane);
    await harness.tmux(
      "resize-window",
      "-t",
      childPane,
      "-x",
      "44",
      "-y",
      "30",
    );
    await Bun.sleep(500);
    await harness.sendKeys(childPane, "C-o");
    await harness.waitUntil(
      "latest child tool output to be collapsed",
      async () => {
        const view = await harness.capture(childPane);
        return (
          view.lastIndexOf("Tool output: collapsed") >
          view.lastIndexOf("Tool output: expanded")
        );
      },
    );

    const collapsedAnswer = await harness.capture(childPane);
    const answerStart = collapsedAnswer.lastIndexOf("FROM PARENT");
    const answerBanner = collapsedAnswer.slice(Math.max(0, answerStart));
    harness.assert(
      answerBanner.includes("Before I update the renderer") &&
        answerBanner.includes("Use blue.") &&
        answerBanner.includes("to expand") &&
        !answerBanner.includes("canonical."),
      `The collapsed parent answer did not show layout A with truncated question context.\n${answerBanner}`,
    );

    await harness.sendKeys(childPane, "C-o");
    await harness.waitUntil(
      "latest child tool output to be expanded",
      async () => {
        const view = await harness.capture(childPane);
        return (
          view.lastIndexOf("Tool output: expanded") >
          view.lastIndexOf("Tool output: collapsed")
        );
      },
    );
    const expandedAnswer = await harness.capture(childPane);
    const expandedAnswerStart = expandedAnswer.lastIndexOf("FROM PARENT");
    const expandedAnswerBanner = expandedAnswer.slice(
      Math.max(0, expandedAnswerStart),
    );
    harness.assert(
      expandedAnswerBanner.includes("canonical.") &&
        !expandedAnswerBanner.includes("to expand"),
      `The expanded parent answer did not show the complete question context.\n${expandedAnswerBanner}`,
    );

    await harness.sendLiteral(childPane, "/subagent-done", true);
    await harness.waitFor("SUBAGENT COMPLETED");
  },
};
