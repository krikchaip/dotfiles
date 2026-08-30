import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import { assertManagedStorage } from "../persistent-state-storage.ts";
import { delay, fauxSubagentDone, sessionPath } from "../provider-support.ts";

function processDescendants(rootPid: number): number[] {
  const snapshot = Bun.spawnSync(["ps", "-axo", "pid=,ppid="]);
  if (snapshot.exitCode !== 0)
    throw new Error("Could not inspect the managed child process tree.");

  const children = new Map<number, number[]>();
  for (const line of new TextDecoder().decode(snapshot.stdout).split("\n")) {
    const [pidText, parentText] = line.trim().split(/\s+/);
    const pid = Number.parseInt(pidText ?? "", 10);
    const parent = Number.parseInt(parentText ?? "", 10);
    if (!Number.isInteger(pid) || !Number.isInteger(parent)) continue;
    children.set(parent, [...(children.get(parent) ?? []), pid]);
  }

  const descendants: number[] = [];
  const queue = [...(children.get(rootPid) ?? [])];
  for (const pid of queue) {
    descendants.push(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  return descendants;
}

function signalProcesses(
  pids: readonly number[],
  signal: NodeJS.Signals,
): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ESRCH") throw cause;
    }
  }
}

export const persistentState: Scenario = {
  name: "persistent-state",
  process: {
    lifecycle: "interactive",
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
  },
  timeoutMs: 45_000,
  configureProvider({ faux, role }) {
    if (role === "child") {
      return faux.setResponses([
        fauxAssistantMessage(
          fauxToolCall("ask_parent", {
            prompt: "Which persistence value should I use?",
          }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage(fauxText("Persistence request remains pending.")),
        fauxAssistantMessage(fauxText("Persistence response applied.")),
        fauxSubagentDone("Persistence response applied."),
      ]);
    }

    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("Agent", {
          description: "E2E delegated task",
          prompt:
            "Persist managed state, then ask the parent which persistence value to use.",
          interactive: true,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("The delegated work is in progress.")),
      async (context: { messages: unknown }) => {
        // Give the harness time to pause the child before the parent writes the
        // response. Without this boundary, the child can consume both mailbox
        // files before their permissions are checked.
        await delay(1_000);
        const resume = sessionPath(
          context.messages,
          /Resume:\s*([^"\n]+session\.jsonl)/,
        );
        return resume
          ? fauxAssistantMessage(
              fauxToolCall("Agent", {
                description: "Answer the E2E child question",
                prompt: "Use durable-state.",
                resume,
              }),
              { stopReason: "toolUse" },
            )
          : fauxAssistantMessage("Missing managed resume path.", {
              stopReason: "error",
              errorMessage: "Missing managed resume path.",
            });
      },
      fauxAssistantMessage(
        fauxText("The parent persisted the child response."),
      ),
    ]);
  },
  async run(harness: E2EHarness) {
    const childPane = await harness.childPane();

    await harness.waitUntil(
      "the storage child to persist its parent request",
      () => harness.filesNamed("request.json").length === 1,
    );

    const childPidText = (
      await harness.tmux(
        "display-message",
        "-p",
        "-t",
        childPane,
        "#{pane_pid}",
      )
    ).trim();

    const childPid = Number.parseInt(childPidText, 10);
    harness.assert(
      Number.isInteger(childPid),
      "Managed child pane did not identify its process.",
    );

    const descendants = processDescendants(childPid);
    const childProcesses = descendants.length > 0 ? descendants : [childPid];
    signalProcesses([...childProcesses].reverse(), "SIGSTOP");

    try {
      await harness.waitFor("Which persistence value should I use?");
      await harness.waitUntil(
        "the parent response to persist while the child is paused",
        () => harness.filesNamed("response.json").length === 1,
      );

      assertManagedStorage("response", harness.stateDirectory, childPane);
    } finally {
      signalProcesses(childProcesses, "SIGCONT");
    }

    await harness.waitForStoredText("Persistence response applied.");
    await harness.sendLiteral(childPane, "/subagent-done", true);
    await harness.waitFor("SUBAGENT COMPLETED");

    assertManagedStorage("terminal", harness.stateDirectory, childPane);
  },
};
