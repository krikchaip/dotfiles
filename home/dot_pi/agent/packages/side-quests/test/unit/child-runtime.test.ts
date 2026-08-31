import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentEndEvent,
  ExtensionAPI,
  ExtensionContext,
  MessageEndEvent,
} from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";

import { ChildRuntime } from "../../child/runtime.ts";
import { RuntimeStore } from "../../store/runtime.ts";
import { SessionStore } from "../../store/session.ts";

const originalEnvironment = {
  childId: process.env.PI_SIDE_QUESTS_CHILD_ID,
  initialPrompt: process.env.PI_SIDE_QUESTS_INITIAL_PROMPT,
  parentId: process.env.PI_SIDE_QUESTS_PARENT_ID,
  root: process.env.PI_CODING_AGENT_DIR,
  session: process.env.PI_SIDE_QUESTS_SESSION,
};
const temporaryRoots: string[] = [];

afterEach(() => {
  process.env.PI_CODING_AGENT_DIR = originalEnvironment.root;
  process.env.PI_SIDE_QUESTS_CHILD_ID = originalEnvironment.childId;
  process.env.PI_SIDE_QUESTS_INITIAL_PROMPT = originalEnvironment.initialPrompt;
  process.env.PI_SIDE_QUESTS_PARENT_ID = originalEnvironment.parentId;
  process.env.PI_SIDE_QUESTS_SESSION = originalEnvironment.session;

  for (const root of temporaryRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function autonomousRuntime(
  lifecycle: "autonomous" | "interactive" = "autonomous",
) {
  const root = mkdtempSync(join(tmpdir(), "side-quests-child-runtime-"));
  temporaryRoots.push(root);
  process.env.PI_CODING_AGENT_DIR = root;
  Reflect.deleteProperty(process.env, "PI_SIDE_QUESTS_INITIAL_PROMPT");

  const manifest = SessionStore.createSync({
    parentId: "parent-id",
    childId: "child-id",
    ownerId: "owner-id",
    cwd: root,
    description: "explicit completion",
    lifecycle,
    inheritContext: false,
    tools: ["read"],
  });
  process.env.PI_SIDE_QUESTS_CHILD_ID = manifest.childId;
  process.env.PI_SIDE_QUESTS_PARENT_ID = manifest.parentId;
  process.env.PI_SIDE_QUESTS_SESSION = manifest.sessionPath;

  const handlers = new Map<string, (...args: never[]) => unknown>();
  const sendMessage = vi.fn(async () => undefined);
  let activeTools = ["read", "ask_parent", "subagent_done"];
  const setActiveTools = vi.fn((names: string[]) => {
    activeTools = [...names];
  });
  const pi = {
    getActiveTools: () => [...activeTools],
    getAllTools: () =>
      ["read", "ask_parent", "subagent_done"].map((name) => ({ name })),
    on(name: string, handler: (...args: never[]) => unknown) {
      handlers.set(name, handler);
    },
    sendMessage,
    setActiveTools,
  } as unknown as ExtensionAPI;

  const runtime = ChildRuntime.register(pi);

  return {
    activeTools: () => activeTools,
    emit(name: string, ...args: unknown[]) {
      return handlers.get(name)?.(...(args as never[]));
    },
    manifest,
    runtime,
    sendMessage,
    setActiveTools,
  };
}

function assistantMessage(
  stopReason: "endTurn" | "toolUse" | "error" | "aborted",
  text = "Final response without declaration.",
): MessageEndEvent["message"] {
  return {
    role: "assistant",
    content:
      stopReason === "toolUse"
        ? [{ type: "toolCall", id: "call-id", name: "read", arguments: {} }]
        : [{ type: "text", text }],
    stopReason,
    ...(stopReason === "error" ? { errorMessage: text } : {}),
  } as MessageEndEvent["message"];
}

function settle(fixture: ReturnType<typeof autonomousRuntime>) {
  const shutdown = vi.fn();
  const notify = vi.fn();
  fixture.emit("agent_settled", { type: "agent_settled" }, {
    shutdown,
    ui: { notify },
  } as unknown as ExtensionContext);
  return { notify, shutdown };
}

function finishRun(
  fixture: ReturnType<typeof autonomousRuntime>,
  assistant: MessageEndEvent["message"],
): void {
  fixture.emit("agent_start");
  fixture.emit("message_end", {
    type: "message_end",
    message: assistant,
  } satisfies MessageEndEvent);
  fixture.emit("agent_end", {
    type: "agent_end",
    messages: [assistant],
  } as AgentEndEvent);
}

test.each([
  ["autonomous", ["read", "ask_parent", "subagent_done"]],
  ["interactive", ["read", "ask_parent"]],
] as const)(
  "activates lifecycle tools for a %s child",
  (lifecycle, expectedTools) => {
    const fixture = autonomousRuntime(lifecycle);
    const shutdown = vi.fn();
    fixture.emit("session_start", { type: "session_start" }, {
      shutdown,
      ui: { notify: vi.fn() },
    } as unknown as ExtensionContext);

    expect(fixture.activeTools()).toEqual(expectedTools);

    fixture.emit(
      "session_shutdown",
      { type: "session_shutdown", reason: "reload" },
      { shutdown } as unknown as ExtensionContext,
    );
  },
);

test("does nothing when an autonomous response omits subagent_done", () => {
  const fixture = autonomousRuntime();
  finishRun(fixture, assistantMessage("endTurn"));

  const { shutdown } = settle(fixture);

  expect(shutdown).not.toHaveBeenCalled();
  expect(fixture.sendMessage).not.toHaveBeenCalled();
  expect(
    RuntimeStore.hasTerminal(
      fixture.manifest.parentId,
      fixture.manifest.childId,
    ),
  ).toBe(false);
});

test("does not continue or close a run settled by another terminating tool", () => {
  const fixture = autonomousRuntime();
  finishRun(fixture, assistantMessage("toolUse"));

  const { shutdown } = settle(fixture);

  expect(shutdown).not.toHaveBeenCalled();
  expect(fixture.sendMessage).not.toHaveBeenCalled();
});

test("subagent_done records completion before settlement and then shuts down", () => {
  const fixture = autonomousRuntime();
  fixture.emit("agent_start");

  fixture.runtime.declareCompletion("  Verified final result.  ");

  const terminal = RuntimeStore.readTerminal(
    fixture.manifest.parentId,
    fixture.manifest.childId,
  );
  expect(terminal?.response).toBe("Verified final result.");

  const { shutdown } = settle(fixture);
  expect(shutdown).toHaveBeenCalledOnce();
  expect(fixture.sendMessage).not.toHaveBeenCalled();
});

test("completion remains declared across queued runs before settlement", () => {
  const fixture = autonomousRuntime();
  fixture.emit("agent_start");
  fixture.runtime.declareCompletion("Final result before queued work.");
  fixture.emit("agent_end", {
    type: "agent_end",
    messages: [],
  } as AgentEndEvent);

  fixture.emit("agent_start");
  expect(() => fixture.runtime.declareCompletion("Duplicate result.")).toThrow(
    "subagent_done has already declared completion",
  );
  fixture.emit("agent_end", {
    type: "agent_end",
    messages: [],
  } as AgentEndEvent);

  const { shutdown } = settle(fixture);
  expect(shutdown).toHaveBeenCalledOnce();
});

test("a missed command completion restores tools and stays open", async () => {
  const fixture = autonomousRuntime();

  await fixture.runtime.startCompletionTurn();
  expect(fixture.activeTools()).toEqual(["subagent_done"]);
  expect(fixture.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({ customType: "side-quest-wrap-up" }),
    { triggerTurn: true, deliverAs: "steer" },
  );

  finishRun(fixture, assistantMessage("endTurn"));
  const { notify, shutdown } = settle(fixture);

  expect(shutdown).not.toHaveBeenCalled();
  expect(fixture.activeTools()).toEqual([
    "read",
    "ask_parent",
    "subagent_done",
  ]);
  expect(notify).toHaveBeenCalledWith(
    "The completion turn did not call subagent_done. The subagent remains open.",
    "warning",
  );
});

test("promotion during a missed completion turn does not restore subagent_done", async () => {
  const fixture = autonomousRuntime();
  await fixture.runtime.startCompletionTurn();
  fixture.emit(
    "input",
    { source: "interactive", text: "Continue under human control." },
    {} as ExtensionContext,
  );

  finishRun(fixture, assistantMessage("endTurn"));
  settle(fixture);

  expect(fixture.activeTools()).toEqual(["read", "ask_parent"]);
  expect(fixture.runtime.isInteractive()).toBe(true);
});

test("promotion removes subagent_done and rejects a stale call", () => {
  const fixture = autonomousRuntime();

  fixture.emit(
    "input",
    { source: "interactive", text: "Take over this child." },
    {} as ExtensionContext,
  );

  expect(fixture.activeTools()).toEqual(["read", "ask_parent"]);
  expect(() => fixture.runtime.declareCompletion("Stale result")).toThrow(
    "subagent_done is unavailable after interactive takeover",
  );
});

test("an interrupted normal autonomous turn remains open", () => {
  const fixture = autonomousRuntime();
  finishRun(
    fixture,
    assistantMessage("aborted", "Interrupted partial output."),
  );

  const { shutdown } = settle(fixture);

  expect(shutdown).not.toHaveBeenCalled();
  expect(
    RuntimeStore.hasTerminal(
      fixture.manifest.parentId,
      fixture.manifest.childId,
    ),
  ).toBe(false);
});

test("an autonomous provider failure remains terminal", () => {
  const fixture = autonomousRuntime();
  finishRun(fixture, assistantMessage("error", "Provider exhausted retries."));

  const { shutdown } = settle(fixture);
  const terminal = RuntimeStore.readTerminal(
    fixture.manifest.parentId,
    fixture.manifest.childId,
  );

  expect(shutdown).toHaveBeenCalledOnce();
  expect(terminal).toMatchObject({
    kind: "failed",
    error: "Provider exhausted retries.",
  });
});
