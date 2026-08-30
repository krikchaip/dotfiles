import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { Context } from "@earendil-works/pi-ai";

import { configureBasicDelegation } from "../provider-support.ts";

const UNMARKED_RESPONSE = "Work is ready but not explicitly completed.";
const FINAL_RESULT = [
  "### Explicit completion result",
  "",
  "The autonomous sub-agent completed and validated the delegated task.",
].join("\n");

function explicitCompletionContract(context: Context): string | undefined {
  const tool = (context.tools ?? []).find(
    (candidate) => candidate.name === "subagent_done",
  );
  const prompt = context.systemPrompt ?? "";
  const failures = [
    ...(!tool ? ["tool missing"] : []),
    ...(tool &&
    !tool.description.includes(
      "final action MUST be exactly one `subagent_done` call",
    )
      ? [`weak description: ${tool.description}`]
      : []),
    ...(!prompt.includes(
      "Autonomous sub-agents MUST use exactly one subagent_done({ result }) tool call as the final action",
    )
      ? ["MUST guideline missing"]
      : []),
    ...(!prompt.includes(
      "Never finish an autonomous side quest with a normal assistant response",
    )
      ? ["normal-response guideline missing"]
      : []),
    ...(!prompt.includes(
      "Emit no assistant text before or after the final subagent_done call",
    )
      ? ["lone-call guideline missing"]
      : []),
  ];

  return failures.length ? failures.join("; ") : undefined;
}

function commandCompletionContract(context: Context): boolean {
  const toolNames = (context.tools ?? []).map((tool) => tool.name);
  const messages = JSON.stringify(context.messages);

  return (
    toolNames.length === 1 &&
    toolNames[0] === "subagent_done" &&
    messages.includes("call `subagent_done` immediately")
  );
}

async function waitForWaiting(harness: E2EHarness): Promise<void> {
  await harness.waitUntil("the unmarked child to remain waiting", () =>
    harness.filesNamed("activity.json").some((path) => {
      try {
        return JSON.parse(harness.read(path)).phase === "waiting";
      } catch {
        return false;
      }
    }),
  );
}

export const explicitCompletion: Scenario = {
  name: "explicit-completion",
  process: {
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
  },
  configureProvider(context) {
    if (context.role === "parent") {
      configureBasicDelegation(context, {
        description: "explicit completion E2E",
        prompt: "Exercise the explicit completion protocol.",
      });
      context.faux.appendResponses([
        fauxAssistantMessage(fauxText("The explicit completion arrived.")),
      ]);
      return;
    }

    context.faux.setResponses([
      (providerContext: Context) => {
        const failure = explicitCompletionContract(providerContext);
        return failure
          ? fauxAssistantMessage(
              `Explicit completion guidance is missing: ${failure}`,
              {
                stopReason: "error",
                errorMessage: `Explicit completion guidance is missing: ${failure}`,
              },
            )
          : fauxAssistantMessage(fauxText(UNMARKED_RESPONSE));
      },
      (providerContext: Context) =>
        commandCompletionContract(providerContext)
          ? fauxAssistantMessage(
              fauxToolCall("subagent_done", { result: FINAL_RESULT }),
              { stopReason: "toolUse" },
            )
          : fauxAssistantMessage(
              "The completion command did not isolate subagent_done.",
              {
                stopReason: "error",
                errorMessage:
                  "The completion command did not isolate subagent_done.",
              },
            ),
    ]);
  },
  async run(harness: E2EHarness) {
    const childPane = await harness.childPane();
    await harness.waitFor(UNMARKED_RESPONSE, 10_000, childPane);
    await waitForWaiting(harness);

    harness.assert(
      (await harness.childPanes()).includes(childPane),
      "A normal assistant response closed the autonomous child.",
    );
    harness.assert(
      harness.filesNamed("terminal.json").length === 0,
      "A normal assistant response wrote a terminal completion.",
    );

    await harness.sendLiteral(childPane, "/subagent-done", true);
    await harness.waitFor("SUBAGENT COMPLETED");

    harness.assert(
      !(await harness.childPanes()).includes(childPane),
      "subagent_done did not close the completed child.",
    );

    const terminals = harness.filesNamed("terminal.json");
    harness.assert(
      terminals.length === 1,
      "Explicit completion did not write exactly one terminal result.",
    );
    harness.assert(
      JSON.parse(harness.read(terminals[0] ?? "")).response === FINAL_RESULT,
      "Explicit completion did not deliver its result verbatim.",
    );
  },
};
