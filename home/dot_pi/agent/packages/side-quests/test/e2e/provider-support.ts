import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

export interface BasicDelegation {
  readonly childResponse?: string;
  readonly description?: string;
  readonly inheritContext?: boolean;
  readonly interactive?: boolean;
  readonly prompt?: string;
  readonly verifyAgentTool?: boolean;
}

export function configureBasicDelegation(
  context: ProviderContext,
  options: BasicDelegation = {},
): void {
  const { faux, role } = context;

  if (role === "child") {
    faux.setResponses([
      fauxAssistantMessage(
        fauxText(
          options.childResponse ?? "Child completed its delegated E2E task.",
        ),
      ),
    ]);
    return;
  }

  const launch = fauxAssistantMessage(
    fauxToolCall("Agent", {
      description: options.description ?? "E2E delegated task",
      prompt: options.prompt ?? "Complete the delegated E2E task.",
      ...(options.inheritContext === undefined
        ? {}
        : { inherit_context: options.inheritContext }),
      ...(options.interactive ? { interactive: true } : {}),
    }),
    { stopReason: "toolUse" },
  );

  faux.setResponses([
    options.verifyAgentTool
      ? (providerContext: { systemPrompt?: string }) => {
          const systemPrompt = providerContext.systemPrompt ?? "";
          const agentListed = systemPrompt.includes(
            "- Agent: Delegate a coherent, non-overlapping branch of the user's goal to a sub-agent, or resume that sub-agent.",
          );
          const lifecycleGuard = systemPrompt.includes(
            "On resume, omit subagent_type, inherit_context, and interactive. These fields configure only a new sub-agent and Agent.resume rejects them.",
          );

          return agentListed && lifecycleGuard
            ? launch
            : fauxAssistantMessage(
                "Agent lifecycle guidance is missing from the system prompt.",
                {
                  stopReason: "error",
                  errorMessage:
                    "Agent lifecycle guidance is missing from the system prompt.",
                },
              );
        }
      : launch,
    fauxAssistantMessage(fauxText("The delegated work is in progress.")),
  ]);
}

export interface ContinuationDelegation {
  readonly childFirstResponse: string;
  readonly childFirstResponseDelayMs?: number;
  readonly childSecondResponse: string;
  readonly continuationDelayMs: number;
  readonly continuationPrompt: string;
  readonly interactive?: boolean;
  readonly launchPrompt: string;
  readonly promoteOnContinuation?: boolean;
  readonly waitForActiveBeforeContinuation?: boolean;
}

export function configureContinuation(
  context: ProviderContext,
  options: ContinuationDelegation,
): void {
  const { faux, role } = context;

  if (role === "child") {
    faux.setResponses([
      async () => {
        if (options.childFirstResponseDelayMs)
          await delay(options.childFirstResponseDelayMs);
        return fauxAssistantMessage(fauxText(options.childFirstResponse));
      },
      fauxAssistantMessage(fauxText(options.childSecondResponse)),
    ]);
    return;
  }

  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("Agent", {
        description: "E2E delegated task",
        prompt: options.launchPrompt,
        ...(options.interactive ? { interactive: true } : {}),
      }),
      { stopReason: "toolUse" },
    ),
    async (providerContext: { messages: unknown }) => {
      await delay(options.continuationDelayMs);

      const path = sessionPath(
        providerContext.messages,
        /Subagent launched\. Session: ([^"\n]+session\.jsonl)/,
      );

      if (path && options.waitForActiveBeforeContinuation)
        await waitForActiveChild(path);

      return path
        ? fauxAssistantMessage(
            fauxToolCall("Agent", {
              description: "Continue the E2E delegated task",
              prompt: options.continuationPrompt,
              resume: path,
              ...(options.promoteOnContinuation ? { interactive: true } : {}),
            }),
            { stopReason: "toolUse" },
          )
        : fauxAssistantMessage("Missing launched session path.", {
            stopReason: "error",
            errorMessage: "Missing launched session path.",
          });
    },
    fauxAssistantMessage(fauxText("The delegated continuation was sent.")),
  ]);
}

export interface ReopenDelegation {
  readonly launchPrompt: string;
  readonly promoteInteractive?: boolean;
  readonly resumedFailure?: string;
  readonly resumedPrompt: string;
}

export function configureReopen(
  context: ProviderContext,
  options: ReopenDelegation,
): void {
  const { faux, initialPrompt, role } = context;

  if (role === "child") {
    faux.setResponses([
      initialPrompt
        ? fauxAssistantMessage(fauxText("First run completed before reopen."))
        : options.resumedFailure
          ? fauxAssistantMessage(options.resumedFailure, {
              stopReason: "error",
              errorMessage: options.resumedFailure,
            })
          : fauxAssistantMessage(fauxText("Reopened run completed.")),
    ]);
    return;
  }

  const responses = [
    fauxAssistantMessage(
      fauxToolCall("Agent", {
        description: "E2E delegated task",
        prompt: options.launchPrompt,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxText("The delegated work is in progress.")),
    (providerContext: { messages: unknown }) => {
      const path = sessionPath(
        providerContext.messages,
        /Resume:\s*([^"\n]+session\.jsonl)/,
      );

      return path
        ? fauxAssistantMessage(
            fauxToolCall("Agent", {
              description: "Reopen the E2E delegated task",
              prompt: options.resumedPrompt,
              resume: path,
              ...(options.promoteInteractive ? { interactive: true } : {}),
            }),
            { stopReason: "toolUse" },
          )
        : fauxAssistantMessage("Missing stopped session path.", {
            stopReason: "error",
            errorMessage: "Missing stopped session path.",
          });
    },
    fauxAssistantMessage(fauxText("The stopped child was reopened.")),
  ];

  if (options.resumedFailure)
    responses.push(fauxAssistantMessage(fauxText("The resumed child failed.")));

  faux.setResponses(responses);
}

export async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForActiveChild(sessionPath: string): Promise<void> {
  const root = process.env.PI_CODING_AGENT_DIR;
  if (!root) throw new Error("The E2E provider has no Pi state directory.");

  const manifest = JSON.parse(
    await readFile(join(dirname(sessionPath), "manifest.json"), "utf8"),
  ) as { childId?: string; parentId?: string };
  const activityPath = join(
    root,
    "side-quests/runtime",
    manifest.parentId ?? "",
    "children",
    manifest.childId ?? "",
    "activity.json",
  );
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    try {
      const snapshot = JSON.parse(await readFile(activityPath, "utf8")) as {
        phase?: string;
      };
      if (snapshot.phase === "active") return;
    } catch {
      // The child can still be creating its first atomic activity snapshot.
    }
    await delay(50);
  }

  throw new Error("The E2E child did not become active before continuation.");
}

export function sessionPath(
  messages: unknown,
  pattern: RegExp,
): string | undefined {
  return JSON.stringify(messages).match(pattern)?.[1];
}
