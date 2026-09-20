import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import {
  configureContinuation,
  configureReopen,
  fauxSubagentDone,
  sessionPath,
} from "../provider-support.ts";

const liveQuestion = "Which source should the named surfer use?";
const liveAnswer = "Use the primary source.";
const stoppedQuestion = "Which source should the stopped surfer use?";
const stoppedAnswer = "Use the archived primary source.";
const interactiveSurfer = {
  surfer: [
    "---",
    "description: Research external sources",
    "display_name: Surfer",
    "interactive: true",
    "---",
  ].join("\n"),
};
const autonomousSurfer = {
  surfer: [
    "---",
    "description: Research external sources",
    "display_name: Surfer",
    "---",
  ].join("\n"),
};

export const namedLiveAnswer: Scenario = {
  name: "named-live-answer",
  process: {
    agentDefinitions: interactiveSurfer,
    managed: true,
    positionalPrompt: "Launch the named surfer answer scenario.",
  },
  configureProvider({ faux, role }) {
    if (role === "child") {
      faux.setResponses([
        fauxAssistantMessage(
          fauxToolCall("ask_parent", { prompt: liveQuestion }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage(
          fauxText("The named surfer is awaiting an answer."),
        ),
        fauxAssistantMessage(
          fauxText("The named surfer applied the live answer."),
        ),
        fauxSubagentDone("The named surfer applied the live answer."),
      ]);
      return;
    }

    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("Agent", {
          description: "Launch named surfer",
          prompt: "Ask which source to use, then wait for the answer.",
          subagent_type: "surfer",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("The named surfer was launched.")),
      (context: { messages: unknown }) => {
        const resume = sessionPath(
          context.messages,
          /Resume:\s*([^"\n]+session\.jsonl)/,
        );

        return resume
          ? fauxAssistantMessage(
              fauxToolCall("Agent", {
                description: "Answer named surfer",
                prompt: liveAnswer,
                resume,
              }),
              { stopReason: "toolUse" },
            )
          : fauxAssistantMessage("Missing named surfer resume path.", {
              stopReason: "error",
              errorMessage: "Missing named surfer resume path.",
            });
      },
      fauxAssistantMessage(fauxText("The named surfer was answered.")),
    ]);
  },
  async run(harness: E2EHarness) {
    const childPane = await harness.childPane();

    await harness.waitFor("SUBAGENT ASKS", 15_000);
    await harness.waitFor("Agent surfer :: Launch named surfer", 15_000);
    await harness.waitFor("Agent surfer :: Answer named surfer", 15_000);
    await harness.waitFor("└ Answered", 15_000);
    await harness.waitFor(
      "The named surfer applied the live answer.",
      15_000,
      childPane,
    );
    await harness.sendLiteral(childPane, "/subagent-done", true);
    await harness.waitFor("SUBAGENT COMPLETED", 15_000);
  },
};

export const namedLiveSteer: Scenario = {
  name: "named-live-steer",
  process: {
    agentDefinitions: interactiveSurfer,
    managed: true,
    positionalPrompt: "Launch the named surfer steering scenario.",
    providerTokensPerSecond: 100,
  },
  configureProvider(context) {
    configureContinuation(context, {
      childFirstResponse: "The named surfer started its first phase.",
      childFirstResponseDelayMs: 5_000,
      childSecondResponse: "The named surfer applied live steering.",
      continuationDelayMs: 100,
      continuationPrompt: "Apply the named surfer steering now.",
      interactive: true,
      launchPrompt: "Start the named surfer steering task.",
      subagentType: "surfer",
      waitForActiveBeforeContinuation: true,
    });
  },
  async run(harness: E2EHarness) {
    const childPane = await harness.childPane();

    await harness.waitFor("Agent surfer :: E2E delegated task", 15_000);
    await harness.waitFor(
      "Agent surfer :: Continue the E2E delegated task",
      15_000,
    );
    await harness.waitFor("└ Steered", 15_000);
    await harness.waitFor(
      "The named surfer applied live steering.",
      15_000,
      childPane,
    );
    await harness.sendLiteral(childPane, "/subagent-done", true);
    await harness.waitFor("SUBAGENT COMPLETED", 15_000);
  },
};

export const namedStoppedReopen: Scenario = {
  name: "named-stopped-reopen",
  process: {
    agentDefinitions: autonomousSurfer,
    managed: true,
    positionalPrompt: "Launch the named surfer reopen scenario.",
  },
  configureProvider(context) {
    configureReopen(context, {
      launchPrompt: "Complete the named surfer task before reopen.",
      resumedPrompt: "Run the reopened named surfer task.",
      subagentType: "surfer",
    });
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("Agent surfer :: E2E delegated task", 15_000);
    await harness.waitFor(
      "Agent surfer :: Reopen the E2E delegated task",
      15_000,
    );
    await harness.waitFor("└ Resumed", 15_000);
    await harness.waitFor("SUBAGENT COMPLETED", 15_000);
  },
};

export const namedStoppedAnswer: Scenario = {
  name: "named-stopped-answer",
  process: {
    agentDefinitions: interactiveSurfer,
    managed: true,
    positionalPrompt: "Launch the stopped named surfer answer scenario.",
  },
  configureProvider({ faux, initialPrompt, role }) {
    if (role === "child") {
      faux.setResponses(
        initialPrompt
          ? [
              fauxAssistantMessage(
                fauxToolCall("ask_parent", { prompt: stoppedQuestion }),
                { stopReason: "toolUse" },
              ),
              fauxAssistantMessage(
                fauxText("The named surfer is awaiting a stopped answer."),
              ),
            ]
          : [
              fauxAssistantMessage(
                fauxText("The named surfer applied the stopped answer."),
              ),
              fauxSubagentDone("The named surfer applied the stopped answer."),
            ],
      );
      return;
    }

    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("Agent", {
          description: "Launch stopped named surfer",
          prompt: "Ask which source to use, then wait for the answer.",
          subagent_type: "surfer",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("The stopped named surfer was launched.")),
      fauxAssistantMessage(
        fauxText("The stopped named surfer question was received."),
      ),
      fauxAssistantMessage(
        fauxText("The stopped named surfer closure was recorded."),
      ),
      (context: { messages: unknown }) => {
        const resume = sessionPath(
          context.messages,
          /Resume:\s*([^"\n]+session\.jsonl)/,
        );

        return resume
          ? fauxAssistantMessage(
              fauxToolCall("Agent", {
                description: "Answer stopped named surfer",
                prompt: stoppedAnswer,
                resume,
              }),
              { stopReason: "toolUse" },
            )
          : fauxAssistantMessage("Missing stopped surfer resume path.", {
              stopReason: "error",
              errorMessage: "Missing stopped surfer resume path.",
            });
      },
      fauxAssistantMessage(fauxText("The stopped named surfer was answered.")),
    ]);
  },
  async run(harness: E2EHarness) {
    const originalPane = await harness.childPane();

    await harness.waitFor("SUBAGENT ASKS", 15_000);
    await harness.waitFor(stoppedQuestion, 15_000);
    await harness.tmux("kill-pane", "-t", originalPane);
    await harness.waitFor("SUBAGENT CLOSED", 15_000);
    await harness.waitFor(
      "The stopped named surfer closure was recorded.",
      15_000,
    );
    await harness.sendParent("Answer the stopped named surfer now.", true);
    await harness.waitFor(
      "Agent surfer :: Answer stopped named surfer",
      15_000,
    );
    await harness.waitFor("└ Answered", 15_000);

    const reopenedPane = await harness.childPane();
    await harness.waitFor(
      "The named surfer applied the stopped answer.",
      15_000,
      reopenedPane,
    );
    await harness.sendLiteral(reopenedPane, "/subagent-done", true);
    await harness.waitFor("SUBAGENT COMPLETED", 15_000);
  },
};
