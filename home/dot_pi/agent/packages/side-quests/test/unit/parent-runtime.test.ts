import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";

import { type ParentChild, ParentRuntime } from "../../parent/runtime.ts";
import { RuntimeStore } from "../../store/runtime.ts";
import { SessionStore } from "../../store/session.ts";
import { Tmux } from "../../tmux.ts";

const originalRoot = process.env.PI_CODING_AGENT_DIR;
const temporaryRoots: string[] = [];

const child = {
  manifest: {
    version: 1 as const,
    childId: "child-id",
    parentId: "parent-id",
    ownerId: "owner-id",
    sessionPath: "/tmp/session.jsonl",
    cwd: "/tmp",
    agentName: "general-purpose" as const,
    displayName: "general-purpose",
    description: "classify runtime state",
    lifecycle: "autonomous" as const,
    inheritContext: false,
    tools: ["read"],
    createdAt: 1,
  },
  paneId: "%1",
  windowId: "@1",
} satisfies ParentChild;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  process.env.PI_CODING_AGENT_DIR = originalRoot;
  for (const root of temporaryRoots.splice(0))
    rmSync(root, { force: true, recursive: true });
});

function runtime(): ParentRuntime {
  const root = mkdtempSync(join(tmpdir(), "side-quests-parent-runtime-"));
  temporaryRoots.push(root);
  process.env.PI_CODING_AGENT_DIR = root;
  return ParentRuntime.register({ on() {} } as unknown as ExtensionAPI);
}

function writeActivity(
  phase: "starting" | "active" | "waiting",
  heartbeatAt: number,
): void {
  RuntimeStore.writeActivity(child.manifest.parentId, {
    childId: child.manifest.childId,
    sequence: 1,
    eventAt: heartbeatAt,
    heartbeatAt,
    phase,
    lifecycle: child.manifest.lifecycle,
    pendingRequest: false,
  });
}

test.each(["autonomous", "interactive"] as const)(
  "includes control tools in %s child startup allowlist",
  (lifecycle) => {
    let command: string[] = [];
    vi.spyOn(Tmux, "createWindow").mockImplementation((params) => {
      command = params.command;
      return { paneId: child.paneId, windowId: child.windowId };
    });
    vi.spyOn(Tmux, "markManagedPane").mockImplementation(() => {});

    runtime().launch({
      ...child.manifest,
      lifecycle,
      childId: `${lifecycle}-child-id`,
    });

    const toolsIndex = command.indexOf("--tools");
    expect(toolsIndex).toBeGreaterThan(-1);
    expect(command[toolsIndex + 1]?.split(",")).toEqual(
      expect.arrayContaining(["ask_parent", "subagent_done"]),
    );
  },
);

test("lists tracked children without probing tmux during render", () => {
  vi.spyOn(Tmux, "createWindow").mockReturnValue({
    paneId: child.paneId,
    windowId: child.windowId,
  });
  vi.spyOn(Tmux, "markManagedPane").mockImplementation(() => {});
  const paneExists = vi.spyOn(Tmux, "paneExists");
  const parent = runtime();
  parent.launch(child.manifest);
  paneExists.mockClear();

  expect(parent.children()).toEqual([child]);
  expect(paneExists).not.toHaveBeenCalled();
});

test("serves tracked widget state without reading files during render", () => {
  vi.spyOn(Tmux, "createWindow").mockReturnValue({
    paneId: child.paneId,
    windowId: child.windowId,
  });
  vi.spyOn(Tmux, "markManagedPane").mockImplementation(() => {});
  const readActivity = vi.spyOn(RuntimeStore, "readActivity");
  const readRequest = vi.spyOn(SessionStore, "readRequest");
  const parent = runtime();
  parent.launch(child.manifest);
  readActivity.mockClear();
  readRequest.mockClear();

  expect(parent.status(child)).toBe("starting");
  expect(parent.replyPending(child)).toBe(false);
  expect(parent.status(child)).toBe("starting");
  expect(parent.replyPending(child)).toBe(false);
  expect(readActivity).not.toHaveBeenCalled();
  expect(readRequest).not.toHaveBeenCalled();
});

test("polls all child process states with one tmux query", () => {
  vi.useFakeTimers();
  const root = mkdtempSync(join(tmpdir(), "side-quests-parent-runtime-"));
  temporaryRoots.push(root);
  process.env.PI_CODING_AGENT_DIR = root;

  let sessionStart:
    | ((event: unknown, context: ExtensionContext) => void)
    | undefined;
  const pi = {
    on(
      event: string,
      handler: (event: unknown, context: ExtensionContext) => void,
    ) {
      if (event === "session_start") sessionStart = handler;
    },
  } as unknown as ExtensionAPI;

  vi.spyOn(Tmux, "createWindow").mockReturnValue({
    paneId: child.paneId,
    windowId: child.windowId,
  });
  vi.spyOn(Tmux, "markManagedPane").mockImplementation(() => {});
  const processStates = vi
    .spyOn(Tmux, "paneProcessStates")
    .mockReturnValue(new Map([[child.paneId, { dead: false }]]));
  const processState = vi.spyOn(Tmux, "paneProcessState");
  const paneExists = vi.spyOn(Tmux, "paneExists");

  const parent = ParentRuntime.register(pi);
  parent.launch(child.manifest);
  sessionStart?.({}, {
    sessionManager: {
      getSessionId: () => child.manifest.parentId,
    },
  } as unknown as ExtensionContext);
  vi.advanceTimersByTime(1_000);

  expect(processStates).toHaveBeenCalledOnce();
  expect(processStates).toHaveBeenCalledWith([child.paneId]);
  expect(processState).not.toHaveBeenCalled();
  expect(paneExists).not.toHaveBeenCalled();
});

test("reports starting when no activity snapshot exists", () => {
  expect(runtime().status(child)).toBe("starting");
});

test.each(["starting", "active", "waiting"] as const)(
  "reports a fresh %s activity phase",
  (phase) => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const parent = runtime();
    writeActivity(phase, Date.now() - 59_999);

    expect(parent.status(child)).toBe(phase);
  },
);

test("reports stalled at the heartbeat deadline", () => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  const parent = runtime();
  writeActivity("active", Date.now() - 60_000);

  expect(parent.status(child)).toBe("stalled");
});

test("reports and clears an unanswered parent request", () => {
  const parent = runtime();
  SessionStore.writeRequest(child.manifest.parentId, {
    requestId: "request-id",
    childId: child.manifest.childId,
    prompt: "Which value should I use?",
    createdAt: Date.now(),
  });

  expect(parent.replyPending(child)).toBe(true);
  SessionStore.clearRequest(child.manifest.parentId, child.manifest.childId);
  expect(parent.replyPending(child)).toBe(false);
});

test.each([
  [true, "answer"],
  [false, "steer"],
] as const)(
  "classifies a live continuation with pending request %s as %s",
  async (pendingRequest, continuationKind) => {
    const parent = runtime();
    vi.spyOn(Tmux, "findManagedPane").mockReturnValue({
      paneId: child.paneId,
      windowId: child.windowId,
    });
    vi.spyOn(Tmux, "paneExists").mockReturnValue(true);

    if (pendingRequest) {
      SessionStore.writeRequest(child.manifest.parentId, {
        requestId: "request-id",
        childId: child.manifest.childId,
        prompt: "Which value should I use?",
        createdAt: Date.now(),
      });
    }

    await expect(
      parent.continue(child.manifest, "Use the reference layout."),
    ).resolves.toEqual({ continuationKind, operation: "continued" });
  },
);

test.each([
  [true, "answer"],
  [false, "steer"],
] as const)(
  "classifies a stopped continuation with pending request %s as %s",
  async (pendingRequest, continuationKind) => {
    const parent = runtime();
    vi.spyOn(Tmux, "findManagedPane").mockReturnValue(undefined);
    vi.spyOn(Tmux, "paneExists").mockReturnValue(false);
    vi.spyOn(Tmux, "createWindow").mockReturnValue({
      paneId: child.paneId,
      windowId: child.windowId,
    });
    vi.spyOn(Tmux, "markManagedPane").mockImplementation(() => {});

    RuntimeStore.writeTerminal(child.manifest.parentId, {
      eventId: "terminal-event",
      childId: child.manifest.childId,
      kind: "closed",
      createdAt: Date.now(),
    });
    if (pendingRequest) {
      SessionStore.writeRequest(child.manifest.parentId, {
        requestId: "request-id",
        childId: child.manifest.childId,
        prompt: "Which value should I use?",
        createdAt: Date.now(),
      });
    }

    await expect(
      parent.continue(child.manifest, "Use the reference layout."),
    ).resolves.toEqual({ continuationKind, operation: "reopened" });
  },
);

test("cancelled events retain pending question and child identity details", () => {
  const root = mkdtempSync(join(tmpdir(), "side-quests-parent-runtime-"));
  temporaryRoots.push(root);
  process.env.PI_CODING_AGENT_DIR = root;

  const sent: Array<{ details?: unknown }> = [];
  const pi = {
    on() {},
    sendMessage(message: { details?: unknown }) {
      sent.push(message);
    },
  } as unknown as ExtensionAPI;

  vi.spyOn(Tmux, "createWindow").mockReturnValue({
    paneId: child.paneId,
    windowId: child.windowId,
  });
  vi.spyOn(Tmux, "markManagedPane").mockImplementation(() => {});
  vi.spyOn(Tmux, "closePane").mockImplementation(() => {});
  vi.spyOn(Tmux, "runningPanes").mockReturnValue([]);

  const parent = ParentRuntime.register(pi);
  parent.launch(child.manifest);
  SessionStore.writeRequest(child.manifest.parentId, {
    requestId: "request-id",
    childId: child.manifest.childId,
    prompt: "Which value should I use?",
    createdAt: Date.now(),
  });

  parent.close(child.manifest.childId);

  expect(sent).toHaveLength(1);
  expect(sent[0]?.details).toMatchObject({
    kind: "cancelled",
    subagentType: "general-purpose",
    description: "classify runtime state",
    pendingRequest: true,
    question: "Which value should I use?",
    sessionPath: "/tmp/session.jsonl",
  });
});
