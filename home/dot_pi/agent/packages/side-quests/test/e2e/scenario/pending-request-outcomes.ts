import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import { fauxSubagentDone } from "../provider-support.ts";

const QUESTIONS = {
  completed:
    "Should the completed outcome retain this unanswered question after the child reaches its terminal state? Confirm that the parent transcript keeps the pending-request warning, uses Unicode-safe truncation at 240 characters, restores the complete question in expanded mode, and preserves the durable request mailbox so a resumed side quest can still receive the answer. Completed pending marker.",
  failed:
    "Should the failed outcome retain this unanswered question after the child reaches its terminal state? Confirm that the parent transcript keeps the pending-request warning, uses Unicode-safe truncation at 240 characters, restores the complete question in expanded mode, and preserves the durable request mailbox so a resumed side quest can still receive the answer. Failed pending marker.",
  cancelled:
    "Should the cancelled outcome retain this unanswered question after the child reaches its terminal state? Confirm that the parent transcript keeps the pending-request warning, uses Unicode-safe truncation at 240 characters, restores the complete question in expanded mode, and preserves the durable request mailbox so a resumed side quest can still receive the answer. Cancelled pending marker.",
} as const;

type PendingOutcome = keyof typeof QUESTIONS;

function configurePendingOutcome(
  { faux, role }: ProviderContext,
  outcome: PendingOutcome,
): void {
  if (role === "child") {
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("ask_parent", { prompt: QUESTIONS[outcome] }),
        { stopReason: "toolUse" },
      ),
      outcome === "completed"
        ? fauxSubagentDone(
            "Completed while the parent request remained pending.",
          )
        : outcome === "failed"
          ? fauxAssistantMessage("Pending request failure.", {
              stopReason: "error",
              errorMessage: "Pending request failure.",
            })
          : fauxAssistantMessage(
              fauxText("Waiting with the parent request still pending."),
            ),
    ]);
    return;
  }

  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("Agent", {
        description: `${outcome} pending-request example`,
        prompt: `Create the ${outcome} pending-request E2E outcome.`,
        ...(outcome === "cancelled" ? { interactive: true } : {}),
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxText("The pending-request child launched.")),
    fauxAssistantMessage(fauxText("The child question remains unanswered.")),
    fauxAssistantMessage(fauxText(`The ${outcome} outcome was recorded.`)),
  ]);
}

async function waitForPendingRequest(
  harness: E2EHarness,
  outcome: PendingOutcome,
): Promise<void> {
  await harness.waitUntil(`${outcome} unanswered parent request`, () => {
    const requests = harness.filesNamed("request.json");
    return (
      requests.length === 1 &&
      harness.read(requests[0] ?? "").includes(QUESTIONS[outcome])
    );
  });
}

async function assertPendingBanner(
  harness: E2EHarness,
  outcome: PendingOutcome,
): Promise<void> {
  await harness.waitFor(`SUBAGENT ${outcome.toUpperCase()}`);

  const collapsed = await harness.capture();

  harness.assert(
    collapsed.includes("PENDING QUESTION"),
    `The ${outcome} result did not label its pending question.\n${collapsed}`,
  );
  harness.assert(
    collapsed.includes("to expand"),
    `The ${outcome} result did not truncate its long pending question.\n${collapsed}`,
  );
  harness.assert(
    collapsed.includes(`Should the ${outcome} outcome retain`),
    `The ${outcome} result did not show its pending question.\n${collapsed}`,
  );
  harness.assert(
    !collapsed.includes("pending marker."),
    `The ${outcome} result showed the complete question while collapsed.\n${collapsed}`,
  );

  await harness.sendParentKeys("C-o");
  await harness.waitFor("pending marker.", 5_000);
  await harness.waitFor("session path:", 5_000);
}

export const pendingRequestCompleted: Scenario = {
  name: "pending-request-completed",
  process: { managed: true, positionalPrompt: "Delegate this E2E task now." },
  configureProvider(context) {
    configurePendingOutcome(context, "completed");
  },
  async run(harness) {
    await harness.childPane();
    await waitForPendingRequest(harness, "completed");
    await assertPendingBanner(harness, "completed");
  },
};

export const pendingRequestFailed: Scenario = {
  name: "pending-request-failed",
  process: { managed: true, positionalPrompt: "Delegate this E2E task now." },
  configureProvider(context) {
    configurePendingOutcome(context, "failed");
  },
  async run(harness) {
    await harness.childPane();
    await waitForPendingRequest(harness, "failed");
    await assertPendingBanner(harness, "failed");
  },
};

export const pendingRequestCancelled: Scenario = {
  name: "pending-request-cancelled",
  process: {
    lifecycle: "interactive",
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
  },
  timeoutMs: 45_000,
  configureProvider(context) {
    configurePendingOutcome(context, "cancelled");
  },
  async run(harness) {
    await harness.childPane();
    await waitForPendingRequest(harness, "cancelled");

    await harness.sendParent("/side-quests", true);
    await harness.waitFor("close", 5_000);
    await harness.sendParent("d");
    await harness.waitFor("Yes", 5_000);
    await harness.sendParentKeys("Enter");

    await assertPendingBanner(harness, "cancelled");
  },
};
