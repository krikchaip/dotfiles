import { dirname, join } from "node:path";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import { delay } from "../provider-support.ts";

const labels = ["alpha", "beta", "gamma"] as const;

export const threeConcurrentQuestions: Scenario = {
  name: "three-concurrent-questions",
  process: {
    lifecycle: "interactive",
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
  },
  timeoutMs: 45_000,
  configureProvider({ faux, initialPrompt, role }) {
    if (role === "child") {
      const label = labels.find((candidate) =>
        initialPrompt.includes(candidate),
      );
      if (!label) throw new Error("Missing concurrent-question child label.");

      return faux.setResponses([
        fauxAssistantMessage(
          fauxToolCall("ask_parent", {
            prompt: `Which token should ${label} use?`,
          }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage(
          fauxText(`Child ${label} continued while waiting.`),
        ),
        (context: { messages: unknown }) =>
          JSON.stringify(context.messages).includes(
            `Answer for child ${label}.`,
          )
            ? fauxAssistantMessage(
                fauxText(`Child ${label} applied answer ${label}.`),
              )
            : fauxAssistantMessage(
                `Child ${label} received the wrong answer.`,
                {
                  stopReason: "error",
                  errorMessage: `Child ${label} received the wrong answer.`,
                },
              ),
      ]);
    }

    const answered = new Set<string>();
    const answerNextQuestion = async (context: { messages: unknown }) => {
      const transcript = JSON.stringify(context.messages);

      if (answered.size === 0) await delay(1_500);

      for (const label of labels) {
        if (answered.has(label)) continue;

        const questionOffset = transcript.lastIndexOf(
          `Which token should ${label} use?`,
        );

        const resume =
          questionOffset < 0
            ? undefined
            : transcript
                .slice(questionOffset)
                .match(/\/[^"\\]+session\.jsonl/)?.[0];

        if (!resume) continue;

        answered.add(label);

        return fauxAssistantMessage(
          fauxToolCall("Agent", {
            description: `Answer E2E question ${label}`,
            prompt: `Answer for child ${label}.`,
            resume,
          }),
          { stopReason: "toolUse" },
        );
      }

      return fauxAssistantMessage("Missing an unhandled child question.", {
        stopReason: "error",
        errorMessage: "Missing an unhandled child question.",
      });
    };

    faux.setResponses([
      fauxAssistantMessage(
        labels.map((label) =>
          fauxToolCall("Agent", {
            description: `E2E question ${label}`,
            prompt: `Ask concurrent parent question ${label}.`,
            interactive: true,
          }),
        ),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("The delegated work is in progress.")),
      answerNextQuestion,
      fauxAssistantMessage(fauxText("The alpha answer was sent.")),
      answerNextQuestion,
      fauxAssistantMessage(fauxText("The beta answer was sent.")),
      answerNextQuestion,
      fauxAssistantMessage(fauxText("The gamma answer was sent.")),
    ]);
  },
  async run(harness: E2EHarness) {
    await harness.childPane();
    await harness.waitUntil(
      "three child parent requests to coexist",
      () => harness.filesNamed("request.json").length === labels.length,
    );

    for (const label of labels)
      await harness.waitFor(`Which token should ${label} use?`);

    await harness.waitUntil(
      "each child to receive its targeted parent answer",
      () =>
        labels.every((label) =>
          harness.filesNamed("manifest.json").some((manifest) => {
            if (!harness.read(manifest).includes(`E2E question ${label}`))
              return false;
            const session = join(dirname(manifest), "session.jsonl");
            return harness
              .read(session)
              .includes(`Child ${label} applied answer ${label}.`);
          }),
        ),
      20_000,
    );

    for (const pane of await harness.childPanes())
      await harness.sendLiteral(pane, "/subagent-done", true);

    await harness.waitFor("Subagent completed:");
  },
};
