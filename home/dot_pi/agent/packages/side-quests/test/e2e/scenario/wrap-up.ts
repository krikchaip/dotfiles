import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { Context } from "@earendil-works/pi-ai";

import {
  configureBasicDelegation,
  delay,
  fauxSubagentDone,
  sessionPath,
} from "../provider-support.ts";

const INITIAL_RESPONSE = "Initial interactive work is ready.";
const REOPENED_RESPONSE = "Transcript reopened for wrap-up banner inspection.";
const RECOVERY_RESPONSE = "Recovery question sent after wrap-up.";
const RECOVERY_QUESTION = "Did ask_parent return after the wrap-up attempt?";
const SYNTHESIS_START = "### Synthesized parent handoff";
const SYNTHESIS_END = "Expanded wrap-up marker.";
const SYNTHESIS_RESPONSE = [
  SYNTHESIS_START,
  "",
  "**Completed work** includes verified files, exact decisions, provider behavior, tool-disabled synthesis, durable transcript storage, lifecycle recovery, interruption handling, Unicode-safe presentation, tmux process cleanup, parent delivery, and focused continuation behavior across every supported interactive completion state.",
  "",
  SYNTHESIS_END,
].join("\n");
const WRAP_UP_PROMPT =
  "Prepare the final handoff to the parent agent and call `subagent_done` immediately";
const LAUNCH_SCOPE_MARKER =
  "The next user message is the side quest launch prompt and starts its handoff scope. Earlier messages are inherited context only.";

type UnsuccessfulWrapUp = "failed" | "interrupted" | "textless";

function hasOnlyCompletionTool(context: Context): boolean {
  const toolNames = (context.tools ?? []).map((tool) => tool.name);
  return toolNames.length === 1 && toolNames[0] === "subagent_done";
}

function hasTool(context: Context, expected: string): boolean {
  return (context.tools ?? []).some((tool) => tool.name === expected);
}

function hasWrapUpPrompt(context: Context, initialPrompt: string): boolean {
  const encoded = context.messages.map((message) => JSON.stringify(message));
  const launchBoundary = encoded.findIndex((message) =>
    message.includes(LAUNCH_SCOPE_MARKER),
  );
  const launchPrompt = encoded.findIndex(
    (message, index) =>
      index > launchBoundary && message.includes(initialPrompt),
  );
  const messages = encoded.join("\n");

  return (
    launchBoundary >= 0 &&
    launchPrompt > launchBoundary &&
    messages.includes(WRAP_UP_PROMPT) &&
    messages.includes("most recent `side-quest-continuation`") &&
    messages.includes("do not summarize earlier work") &&
    messages.includes("most recent `side-quest-launch`") &&
    messages.includes("Inherited messages before it are context only") &&
    messages.includes("answer a question directly") &&
    messages.includes("summarize the decision and trade-offs") &&
    messages.includes("Do not force a template, headings, or sections")
  );
}

function foregroundBefore(view: string, label: string): string | undefined {
  const index = view.indexOf(label);
  if (index < 0) return undefined;

  return view
    .slice(Math.max(0, index - 160), index)
    .match(/38;2;\d+;\d+;\d+m/g)
    ?.at(-1);
}

function configureParent(context: ProviderContext, description: string): void {
  configureBasicDelegation(context, {
    description,
    interactive: true,
    prompt: `Exercise ${description}.`,
  });
  context.faux.appendResponses([
    fauxAssistantMessage(fauxText("The child requested recovery help.")),
    fauxAssistantMessage(fauxText("The child completion was received.")),
  ]);
}

function configureSuccessfulParent(context: ProviderContext): void {
  configureBasicDelegation(context, {
    description: "successful wrap-up E2E",
    interactive: true,
    prompt: "Exercise successful wrap-up E2E.",
  });
  context.faux.appendResponses([
    async (providerContext: Context) => {
      await delay(1_500);
      const path = sessionPath(
        providerContext.messages,
        /Resume:\s*([^"\n]+session\.jsonl)/,
      );

      return path
        ? fauxAssistantMessage(
            fauxToolCall("Agent", {
              description: "Inspect wrap-up transcript",
              prompt: "Reopen for transcript inspection.",
              resume: path,
            }),
            { stopReason: "toolUse" },
          )
        : fauxAssistantMessage("Missing completed wrap-up session path.", {
            stopReason: "error",
            errorMessage: "Missing completed wrap-up session path.",
          });
    },
    fauxAssistantMessage(fauxText("The wrap-up transcript was reopened.")),
  ]);
}

function configureUnsuccessfulWrapUp(
  context: ProviderContext,
  outcome: UnsuccessfulWrapUp,
): void {
  if (context.role === "parent") {
    configureParent(context, `${outcome} wrap-up E2E`);
    return;
  }

  context.faux.setResponses([
    fauxAssistantMessage(fauxText(INITIAL_RESPONSE)),
    async (providerContext: Context) => {
      await delay(750);
      if (
        !hasOnlyCompletionTool(providerContext) ||
        !hasWrapUpPrompt(providerContext, context.initialPrompt)
      )
        return fauxAssistantMessage(
          "Wrap-up turn did not isolate subagent_done or missed its synthesis prompt.",
          {
            stopReason: "error",
            errorMessage:
              "Wrap-up turn did not isolate subagent_done or missed its synthesis prompt.",
          },
        );

      if (outcome === "failed")
        return fauxAssistantMessage("Synthetic wrap-up provider failure.", {
          stopReason: "error",
          errorMessage: "Synthetic wrap-up provider failure.",
        });

      return fauxAssistantMessage([], {
        stopReason: outcome === "interrupted" ? "aborted" : "stop",
      });
    },
    (providerContext: Context) =>
      hasTool(providerContext, "ask_parent")
        ? fauxAssistantMessage(
            fauxToolCall("ask_parent", { prompt: RECOVERY_QUESTION }),
            { stopReason: "toolUse" },
          )
        : fauxAssistantMessage("ask_parent was not restored after wrap-up.", {
            stopReason: "error",
            errorMessage: "ask_parent was not restored after wrap-up.",
          }),
    fauxAssistantMessage(fauxText(RECOVERY_RESPONSE)),
    fauxSubagentDone(RECOVERY_RESPONSE),
  ]);
}

function hasActivityPhase(
  harness: E2EHarness,
  phase: "active" | "waiting",
): boolean {
  return harness.filesNamed("activity.json").some((path) => {
    try {
      return JSON.parse(harness.read(path)).phase === phase;
    } catch {
      return false;
    }
  });
}

async function waitForPhase(
  harness: E2EHarness,
  phase: "active" | "waiting",
): Promise<void> {
  await harness.waitUntil(`the child to become ${phase}`, () =>
    hasActivityPhase(harness, phase),
  );
}

async function waitForWaiting(harness: E2EHarness): Promise<void> {
  await waitForPhase(harness, "waiting");
}

async function proveUnsuccessfulWrapUpRecovery(
  harness: E2EHarness,
  outcome: UnsuccessfulWrapUp,
): Promise<void> {
  const childPane = await harness.childPane();
  await harness.waitFor(INITIAL_RESPONSE, 10_000, childPane);
  await waitForWaiting(harness);

  await harness.sendLiteral(childPane, "/subagent-done", true);
  await waitForPhase(harness, "active");
  if (outcome === "failed")
    await harness.waitForStoredText("Synthetic wrap-up provider failure.");
  await waitForWaiting(harness);

  const livePane = (
    await harness.tmux("display-message", "-p", "-t", childPane, "#{pane_id}")
  ).trim();
  harness.assert(
    livePane === childPane,
    `The ${outcome} wrap-up closed its interactive child pane.`,
  );
  harness.assert(
    harness.filesNamed("terminal.json").length === 0,
    `The ${outcome} wrap-up wrote a terminal result.`,
  );
  const failedSession = harness.read(
    harness.filesNamed("session.jsonl")[0] ?? "",
  );
  harness.assert(
    !failedSession.includes('"name":"subagent_done"'),
    `The ${outcome} wrap-up persisted a successful completion call.`,
  );
  harness.assert(
    !(await harness.capture(childPane)).includes("WRAP UP"),
    `The ${outcome} wrap-up displayed a final banner.`,
  );

  await harness.sendLiteral(
    childPane,
    "Use ask_parent now to prove the child tools were restored.",
    true,
  );
  await harness.waitFor("SUBAGENT ASKS", 10_000);
  await harness.waitForStoredText(RECOVERY_QUESTION);
  await harness.waitForStoredText(RECOVERY_RESPONSE);
  await waitForWaiting(harness);

  await harness.sendLiteral(childPane, "/subagent-done", true);
  await harness.waitFor("SUBAGENT COMPLETED");
}

export const wrapUpSuccess: Scenario = {
  name: "wrap-up-success",
  process: {
    lifecycle: "interactive",
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
    providerTokensPerSecond: 20,
  },
  configureProvider(context) {
    if (context.role === "parent") {
      configureSuccessfulParent(context);
      return;
    }

    if (!context.initialPrompt) {
      context.faux.setResponses([
        fauxAssistantMessage(fauxText(REOPENED_RESPONSE)),
      ]);
      return;
    }

    context.faux.setResponses([
      fauxAssistantMessage(fauxText(INITIAL_RESPONSE)),
      async (providerContext: Context) => {
        await delay(750);
        return hasOnlyCompletionTool(providerContext) &&
          hasWrapUpPrompt(providerContext, context.initialPrompt)
          ? fauxSubagentDone(SYNTHESIS_RESPONSE)
          : fauxAssistantMessage(
              "Wrap-up turn did not isolate subagent_done or missed its synthesis prompt.",
              {
                stopReason: "error",
                errorMessage:
                  "Wrap-up turn did not isolate subagent_done or missed its synthesis prompt.",
              },
            );
      },
    ]);
  },
  async run(harness: E2EHarness) {
    const childPane = await harness.childPane();
    await harness.waitFor(INITIAL_RESPONSE, 10_000, childPane);
    await waitForWaiting(harness);

    await harness.sendLiteral(childPane, "/subagent-done", true);
    await delay(1_100);
    const streamingView = await harness.capture(childPane);
    harness.assert(
      !streamingView.includes("WRAP UP") &&
        !streamingView.includes(SYNTHESIS_START) &&
        (await harness.childPanes()).includes(childPane),
      "Wrap-up synthesis was visible before the complete banner was ready.",
    );

    await harness.waitFor("SUBAGENT COMPLETED");

    harness.assert(
      !(await harness.childPanes()).includes(childPane),
      "Successful wrap-up did not exit after synthesis.",
    );

    const terminals = harness.filesNamed("terminal.json");
    harness.assert(
      terminals.length === 1,
      "Successful wrap-up did not persist exactly one terminal result.",
    );
    const terminal = harness.read(terminals[0] ?? "");
    harness.assert(
      JSON.parse(terminal).response === SYNTHESIS_RESPONSE,
      `Successful wrap-up did not return its synthesis.\n${terminal}`,
    );
    harness.assert(
      !terminal.includes(INITIAL_RESPONSE),
      "Successful wrap-up returned the stale pre-synthesis response.",
    );

    await harness.waitFor("Agent general-purpose (resumed)");
    const reopenedPane = await harness.childPane();
    const view = await harness.waitFor(REOPENED_RESPONSE, 10_000, reopenedPane);
    const wrapUpHeadings = view.match(/WRAP UP/g) ?? [];
    const synthesisCopies = view.match(/Synthesized parent handoff/g) ?? [];

    harness.assert(
      wrapUpHeadings.length === 1,
      `The reopened transcript rendered ${wrapUpHeadings.length} WRAP UP headings instead of one.`,
    );
    harness.assert(
      synthesisCopies.length === 1,
      `The final synthesis rendered ${synthesisCopies.length} times instead of once.`,
    );
    harness.assert(
      view.includes("to expand") && !view.includes(SYNTHESIS_END),
      "The final wrap-up banner did not use collapsed transcript rendering.",
    );
    harness.assert(
      !view.includes(WRAP_UP_PROMPT),
      "The model-only wrap-up request was visible in the reopened transcript.",
    );

    const ansiView = await harness.tmux(
      "capture-pane",
      "-p",
      "-e",
      "-J",
      "-t",
      reopenedPane,
      "-S",
      "-",
    );
    const headingIndex = ansiView.indexOf("WRAP UP");
    const synthesisIndex = ansiView.indexOf("Synthesized parent handoff");
    const bannerAnsi = ansiView.slice(
      Math.max(0, headingIndex - 120),
      synthesisIndex + SYNTHESIS_START.length + 120,
    );
    harness.assert(
      headingIndex >= 0 &&
        synthesisIndex > headingIndex &&
        bannerAnsi.includes("\u001b[48;2;"),
      "The final wrap-up text was not rendered inside a styled TUI banner.",
    );
    harness.assert(
      foregroundBefore(ansiView, "WRAP UP") ===
        foregroundBefore(ansiView, "FROM PARENT") &&
        foregroundBefore(ansiView, "WRAP UP") !== undefined,
      "WRAP UP did not use the FROM PARENT label color.",
    );

    await harness.sendKeys(reopenedPane, "C-o");
    const expanded = await harness.waitFor(SYNTHESIS_END, 5_000, reopenedPane);
    harness.assert(
      (expanded.match(/Expanded wrap-up marker\./g) ?? []).length === 1,
      "Expanded wrap-up did not show its complete response exactly once.",
    );

    const session = harness.read(harness.filesNamed("session.jsonl")[0] ?? "");
    harness.assert(
      (session.match(/\"name\":\"subagent_done\"/g) ?? []).length === 1 &&
        session.includes(JSON.stringify(SYNTHESIS_RESPONSE)),
      "Successful wrap-up did not persist exactly one completion tool call with its result.",
    );
    harness.assert(
      session.includes(
        '"type":"custom_message","customType":"side-quest-wrap-up"',
      ) && session.includes('"display":false'),
      "The completion request was not persisted as a hidden message.",
    );
  },
};

export const wrapUpFailed: Scenario = {
  name: "wrap-up-failed",
  process: {
    lifecycle: "interactive",
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
  },
  configureProvider(context) {
    configureUnsuccessfulWrapUp(context, "failed");
  },
  async run(harness: E2EHarness) {
    await proveUnsuccessfulWrapUpRecovery(harness, "failed");
  },
};

export const wrapUpInterrupted: Scenario = {
  name: "wrap-up-interrupted",
  process: {
    lifecycle: "interactive",
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
  },
  configureProvider(context) {
    configureUnsuccessfulWrapUp(context, "interrupted");
  },
  async run(harness: E2EHarness) {
    await proveUnsuccessfulWrapUpRecovery(harness, "interrupted");
  },
};

export const wrapUpTextless: Scenario = {
  name: "wrap-up-textless",
  process: {
    lifecycle: "interactive",
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
  },
  configureProvider(context) {
    configureUnsuccessfulWrapUp(context, "textless");
  },
  async run(harness: E2EHarness) {
    await proveUnsuccessfulWrapUpRecovery(harness, "textless");
  },
};
