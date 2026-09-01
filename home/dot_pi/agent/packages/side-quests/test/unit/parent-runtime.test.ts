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
  async (lifecycle) => {
    let command: string[] = [];
    vi.spyOn(Tmux, "createWindow").mockImplementation(async (params) => {
      command = params.command;
      return { paneId: child.paneId, windowId: child.windowId };
    });
    vi.spyOn(Tmux, "markManagedPane").mockResolvedValue();

    await runtime().launch({
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

test("leaves initial shared-window title ownership inside tmux", async () => {
  let creation: Parameters<typeof Tmux.createWindow>[0] | undefined;
  vi.spyOn(Tmux, "createWindow").mockImplementation(async (params) => {
    creation = params;
    return { paneId: child.paneId, windowId: child.windowId };
  });
  vi.spyOn(Tmux, "markManagedPane").mockResolvedValue();
  vi.spyOn(Tmux, "selectedPaneId").mockResolvedValue({
    paneId: child.paneId,
  });
  vi.spyOn(Tmux, "setAutomaticWindowTitle").mockResolvedValue(undefined);

  await runtime().launch(child.manifest);

  expect(creation).not.toHaveProperty("name");
});

test("reserves launch order before session preparation finishes", async () => {
  const order: string[] = [];
  vi.spyOn(Tmux, "createWindow").mockImplementation(async (params) => {
    order.push(params.environment.PI_SIDE_QUESTS_CHILD_ID ?? "");
    return { paneId: "%1", windowId: "@1" };
  });
  vi.spyOn(Tmux, "runningPanesAsync").mockResolvedValue([
    { id: "%1", pid: 1, dead: false },
  ]);
  vi.spyOn(Tmux, "startPiPane").mockImplementation(async (params) => {
    order.push(params.environment.PI_SIDE_QUESTS_CHILD_ID ?? "");
    return "%2";
  });
  vi.spyOn(Tmux, "markManagedPane").mockResolvedValue();
  vi.spyOn(Tmux, "applyWindowLayoutAsync").mockResolvedValue();

  let resolveFirst: ((manifest: typeof child.manifest) => void) | undefined;
  let resolveSecond: ((manifest: typeof child.manifest) => void) | undefined;
  const first = new Promise<typeof child.manifest>((resolve) => {
    resolveFirst = resolve;
  });
  const second = new Promise<typeof child.manifest>((resolve) => {
    resolveSecond = resolve;
  });
  const parent = runtime();
  const firstLaunch = parent.launch(first);
  const secondLaunch = parent.launch(second);

  resolveSecond?.({ ...child.manifest, childId: "second-child" });
  await Promise.resolve();
  expect(order).toEqual([]);

  resolveFirst?.({ ...child.manifest, childId: "first-child" });
  await Promise.all([firstLaunch, secondLaunch]);

  expect(order).toEqual(["first-child", "second-child"]);
});

test("lists tracked children without probing tmux during render", async () => {
  vi.spyOn(Tmux, "createWindow").mockResolvedValue({
    paneId: child.paneId,
    windowId: child.windowId,
  });
  vi.spyOn(Tmux, "markManagedPane").mockResolvedValue();
  const paneExists = vi.spyOn(Tmux, "paneExists");
  const parent = runtime();
  await parent.launch(child.manifest);
  paneExists.mockClear();

  expect(parent.children()).toEqual([child]);
  expect(paneExists).not.toHaveBeenCalled();
});

test("serves tracked widget state without reading files during render", async () => {
  vi.spyOn(Tmux, "createWindow").mockResolvedValue({
    paneId: child.paneId,
    windowId: child.windowId,
  });
  vi.spyOn(Tmux, "markManagedPane").mockResolvedValue();
  const readActivity = vi.spyOn(RuntimeStore, "readActivity");
  const readRequest = vi.spyOn(SessionStore, "readRequest");
  const parent = runtime();
  await parent.launch(child.manifest);
  readActivity.mockClear();
  readRequest.mockClear();

  expect(parent.status(child)).toBe("starting");
  expect(parent.replyPending(child)).toBe(false);
  expect(parent.status(child)).toBe("starting");
  expect(parent.replyPending(child)).toBe(false);
  expect(readActivity).not.toHaveBeenCalled();
  expect(readRequest).not.toHaveBeenCalled();
});

test("polls all child process states with one tmux query", async () => {
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

  vi.spyOn(Tmux, "createWindow").mockResolvedValue({
    paneId: child.paneId,
    windowId: child.windowId,
  });
  vi.spyOn(Tmux, "markManagedPane").mockResolvedValue();
  const processStates = vi
    .spyOn(Tmux, "paneProcessStates")
    .mockReturnValue(new Map([[child.paneId, { dead: false }]]));
  const processState = vi.spyOn(Tmux, "paneProcessState");
  const paneExists = vi.spyOn(Tmux, "paneExists");

  const parent = ParentRuntime.register(pi);
  await parent.launch(child.manifest);
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
    vi.spyOn(Tmux, "createWindow").mockResolvedValue({
      paneId: child.paneId,
      windowId: child.windowId,
    });
    vi.spyOn(Tmux, "markManagedPane").mockResolvedValue();

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

test("title update failures warn once, retry, and do not block launch", async () => {
  vi.useFakeTimers();
  const root = mkdtempSync(join(tmpdir(), "side-quests-parent-runtime-"));
  temporaryRoots.push(root);
  process.env.PI_CODING_AGENT_DIR = root;

  const handlers = new Map<
    string,
    (event: { reason?: string }, context: ExtensionContext) => void
  >();
  const notify = vi.fn();
  const pi = {
    on(
      event: string,
      handler: (event: { reason?: string }, context: ExtensionContext) => void,
    ) {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI;
  const context = {
    sessionManager: { getSessionId: () => child.manifest.parentId },
    ui: { notify },
  } as unknown as ExtensionContext;

  vi.spyOn(Tmux, "createWindow").mockResolvedValue({
    paneId: child.paneId,
    windowId: child.windowId,
  });
  vi.spyOn(Tmux, "markManagedPane").mockResolvedValue();
  const selectedPane = vi
    .spyOn(Tmux, "selectedPaneId")
    .mockResolvedValueOnce({ paneId: child.paneId })
    .mockResolvedValue({ error: "selected pane command failed" });
  let finishTitle: (error: string | undefined) => void = () => {};
  const pendingTitle = new Promise<string | undefined>((resolve) => {
    finishTitle = resolve;
  });
  const setTitle = vi
    .spyOn(Tmux, "setAutomaticWindowTitle")
    .mockReturnValue(pendingTitle);
  vi.spyOn(Tmux, "paneProcessStates").mockReturnValue(
    new Map([[child.paneId, { dead: false }]]),
  );
  vi.spyOn(Tmux, "paneExists").mockReturnValue(true);

  const parent = ParentRuntime.register(pi);
  handlers.get("session_start")?.({}, context);

  let launchResolved = false;
  const launch = parent.launch(child.manifest).then((manifest) => {
    launchResolved = true;
    return manifest;
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(launchResolved).toBe(true);
  await expect(launch).resolves.toEqual(child.manifest);

  let continuationResolved = false;
  const continuation = parent
    .continue(
      { ...child.manifest, description: "continued title" },
      "Continue without waiting for title work.",
    )
    .then((result) => {
      continuationResolved = true;
      return result;
    });
  await vi.advanceTimersByTimeAsync(2_100);
  expect(continuationResolved).toBe(true);
  await expect(continuation).resolves.toEqual({
    continuationKind: "steer",
    operation: "continued",
  });
  expect(setTitle).toHaveBeenCalledTimes(1);

  finishTitle(undefined);
  await vi.advanceTimersByTimeAsync(0);

  expect(setTitle).toHaveBeenCalledTimes(1);
  expect(selectedPane).toHaveBeenCalledTimes(2);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledWith(
    "Side Quests could not update the tmux window title: selected pane command failed",
    "warning",
  );

  await vi.advanceTimersByTimeAsync(1_000);
  expect(selectedPane.mock.calls.length).toBeGreaterThan(2);
  expect(notify).toHaveBeenCalledTimes(1);

  handlers.get("session_shutdown")?.({ reason: "reload" }, context);
});

test("cancelled events retain pending question and child identity details", async () => {
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

  vi.spyOn(Tmux, "createWindow").mockResolvedValue({
    paneId: child.paneId,
    windowId: child.windowId,
  });
  vi.spyOn(Tmux, "markManagedPane").mockResolvedValue();
  vi.spyOn(Tmux, "closePane").mockImplementation(() => {});
  vi.spyOn(Tmux, "runningPanes").mockReturnValue([]);

  const parent = ParentRuntime.register(pi);
  await parent.launch(child.manifest);
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
