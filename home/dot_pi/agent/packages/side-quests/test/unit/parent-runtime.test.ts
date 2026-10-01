import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { type ParentChild, ParentRuntime } from "../../parent/runtime.ts";
import { RuntimeStore } from "../../store/runtime.ts";
import { SessionStore } from "../../store/session.ts";
import { Tmux } from "../../tmux.ts";

const originalRoot = process.env.PI_CODING_AGENT_DIR;
const temporaryRoots: string[] = [];

beforeEach(() => {
  vi.spyOn(Tmux, "selectedPaneId").mockResolvedValue({ missing: true });
  vi.spyOn(RuntimeStore, "readReadiness").mockImplementation(
    (_parentId, childId) => ({
      version: 1,
      childId,
      status: "ready",
      createdAt: Date.now(),
    }),
  );
});

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
  if (originalRoot === undefined)
    Reflect.deleteProperty(process.env, "PI_CODING_AGENT_DIR");
  else process.env.PI_CODING_AGENT_DIR = originalRoot;
  for (const root of temporaryRoots.splice(0))
    rmSync(root, { force: true, recursive: true });
});

function runtime(registeredToolNames = ["read", "grep"]): ParentRuntime {
  const root = mkdtempSync(join(tmpdir(), "side-quests-parent-runtime-"));
  temporaryRoots.push(root);
  process.env.PI_CODING_AGENT_DIR = root;
  return ParentRuntime.register({
    getAllTools: () => registeredToolNames.map((name) => ({ name })),
    on() {},
  } as unknown as ExtensionAPI);
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

test("waits for explicit child readiness before launch succeeds", async () => {
  vi.useFakeTimers();
  vi.spyOn(Tmux, "createWindow").mockResolvedValue({
    paneId: child.paneId,
    windowId: child.windowId,
  });
  vi.spyOn(Tmux, "markManagedPane").mockResolvedValue();
  const parent = runtime();
  let checked: () => void = () => {};
  const firstReadinessCheck = new Promise<void>((resolve) => {
    checked = resolve;
  });
  vi.mocked(RuntimeStore.readReadiness)
    .mockImplementationOnce(() => {
      checked();
      return undefined;
    })
    .mockReturnValue({
      version: 1,
      childId: child.manifest.childId,
      status: "ready",
      createdAt: Date.now(),
    });

  let settled = false;
  const launch = parent.launch(child.manifest).then((manifest) => {
    settled = true;
    return manifest;
  });
  await firstReadinessCheck;
  expect(settled).toBe(false);

  await vi.advanceTimersByTimeAsync(25);
  await expect(launch).resolves.toEqual(child.manifest);
});

test("failed readiness closes the pane and removes temporary session state", async () => {
  const parent = runtime();
  const manifest = SessionStore.createSync({
    parentId: "parent-id",
    childId: "failed-child-id",
    ownerId: parent.ownerId,
    cwd: "/tmp",
    description: "fail readiness",
    lifecycle: "autonomous",
    inheritContext: false,
    tools: ["child_only"],
  });
  vi.spyOn(Tmux, "createWindow").mockResolvedValue({
    paneId: child.paneId,
    windowId: child.windowId,
  });
  vi.spyOn(Tmux, "markManagedPane").mockResolvedValue();
  const closePane = vi.spyOn(Tmux, "closePane").mockImplementation(() => {});
  vi.mocked(RuntimeStore.readReadiness).mockReturnValue({
    version: 1,
    childId: manifest.childId,
    status: "failed",
    createdAt: Date.now(),
    error: "/tmp/extension.ts: fixture exploded",
  });

  await expect(
    parent.launch(manifest, "Start the failed fixture.", {
      removeSessionOnFailure: true,
    }),
  ).rejects.toThrow("/tmp/extension.ts: fixture exploded");

  expect(closePane).toHaveBeenCalledWith(child.paneId);
  expect(SessionStore.readManifest(manifest.sessionPath)).toBeUndefined();
});

test.each(["autonomous", "interactive"] as const)(
  "includes control tools in %s child startup allowlist",
  async (lifecycle) => {
    let command: string[] = [];
    vi.spyOn(Tmux, "createWindow").mockImplementation(async (params) => {
      command = JSON.parse(
        readFileSync(params.command[2] ?? "", "utf8"),
      ).command;
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

test.each(["autonomous", "interactive"] as const)(
  "allows initial broad discovery but denies spawning in a %s child",
  async (lifecycle) => {
    let command: string[] = [];
    vi.spyOn(Tmux, "createWindow").mockImplementation(async (params) => {
      command = JSON.parse(
        readFileSync(params.command[2] ?? "", "utf8"),
      ).command;
      return { paneId: child.paneId, windowId: child.windowId };
    });
    vi.spyOn(Tmux, "markManagedPane").mockResolvedValue();
    await runtime().launch({
      ...child.manifest,
      lifecycle,
      discoverTools: true,
    });
    expect(command).not.toContain("--tools");
    expect(command[command.indexOf("--exclude-tools") + 1]?.split(",")).toEqual(
      ["Agent", "Task", "delegate", "spawn_agent", "subagent"],
    );
  },
);

test("returns the child's finalized manifest only after readiness", async () => {
  const parent = runtime();
  const pending = SessionStore.createSync({
    ...child.manifest,
    discoverTools: true,
  });
  const finalized = SessionStore.finalizeTools(pending, ["read", "child_only"]);
  vi.spyOn(Tmux, "createWindow").mockResolvedValue({
    paneId: child.paneId,
    windowId: child.windowId,
  });
  vi.spyOn(Tmux, "markManagedPane").mockResolvedValue();
  await expect(parent.launch(pending)).resolves.toEqual(finalized);
});

test("keeps the requested reopen label after readiness without unfreezing policy", async () => {
  const parent = runtime();
  const saved = SessionStore.createSync(child.manifest);
  const requested = { ...saved, description: "reopened task label" };
  vi.spyOn(Tmux, "createWindow").mockResolvedValue({
    paneId: child.paneId,
    windowId: child.windowId,
  });
  vi.spyOn(Tmux, "markManagedPane").mockResolvedValue();
  await expect(parent.launch(requested)).resolves.toEqual(requested);
  expect(parent.children()[0]?.manifest.description).toBe(
    "reopened task label",
  );
});

test("starts a frozen skill policy with no discovery and exact skill paths", async () => {
  let command: string[] = [];
  vi.spyOn(Tmux, "createWindow").mockImplementation(async (params) => {
    command = JSON.parse(readFileSync(params.command[2] ?? "", "utf8")).command;
    return { paneId: child.paneId, windowId: child.windowId };
  });
  vi.spyOn(Tmux, "markManagedPane").mockResolvedValue();

  await runtime().launch({
    ...child.manifest,
    noSkills: true,
    skillPaths: ["/tmp/skills/research/SKILL.md", "/tmp/skills/tdd/SKILL.md"],
  });

  expect(command).toContain("--no-skills");
  expect(command.filter((argument) => argument === "--skill")).toHaveLength(2);
  expect(command).toEqual(
    expect.arrayContaining([
      "/tmp/skills/research/SKILL.md",
      "/tmp/skills/tdd/SKILL.md",
    ]),
  );
});

test("hosts frozen extensions once while replaying parent prompt inputs", async () => {
  let command: string[] = [];
  vi.spyOn(Tmux, "createWindow").mockImplementation(async (params) => {
    command = JSON.parse(readFileSync(params.command[2] ?? "", "utf8")).command;
    return { paneId: child.paneId, windowId: child.windowId };
  });
  vi.spyOn(Tmux, "markManagedPane").mockResolvedValue();

  await runtime().launch({
    ...child.manifest,
    extensionPaths: ["/tmp/extensions/one-off.ts"],
    parentSystemPromptInputs: {
      appendSystemPrompt: "PARENT APPEND",
      contextFiles: [
        { content: "PARENT CONTEXT", path: "/tmp/parent/AGENTS.md" },
      ],
      customPrompt: "PARENT CUSTOM",
    },
  });

  const childExtension = command.indexOf(
    new URL("../../child/index.ts", import.meta.url).pathname,
  );
  const append = command.indexOf("--append-system-prompt");
  expect(command).not.toContain("/tmp/extensions/one-off.ts");
  expect(command).toContain("--no-extensions");
  expect(childExtension).toBeGreaterThan(-1);
  expect(command.filter((argument) => argument === "--extension")).toHaveLength(
    2,
  );
  expect(command[command.indexOf("--extension") + 1]).toMatch(
    /\/child-id\/extensions\/0\.ts$/,
  );
  expect(command).toEqual(
    expect.arrayContaining([
      "--system-prompt",
      "PARENT CUSTOM",
      "--no-context-files",
    ]),
  );
  expect(command[append + 1]).toContain("PARENT APPEND");
  expect(command[append + 1]).toContain("PARENT CONTEXT");
});

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

test("rejects failed child readiness before sending a continuation prompt", async () => {
  const parent = runtime([]);
  const writeResponse = vi.spyOn(SessionStore, "writeResponse");
  const createWindow = vi.spyOn(Tmux, "createWindow").mockResolvedValue({
    paneId: child.paneId,
    windowId: child.windowId,
  });
  vi.spyOn(Tmux, "findManagedPane").mockReturnValue(undefined);
  vi.spyOn(Tmux, "paneExists").mockReturnValue(false);
  vi.spyOn(Tmux, "markManagedPane").mockResolvedValue();
  const closePane = vi.spyOn(Tmux, "closePane").mockImplementation(() => {});
  vi.mocked(RuntimeStore.readReadiness).mockReturnValue({
    version: 1,
    childId: child.manifest.childId,
    status: "failed",
    createdAt: Date.now(),
    error: "Missing required child tools: read",
  });

  await expect(
    parent.continue(child.manifest, "Resume the restricted reviewer."),
  ).rejects.toThrow("Missing required child tools: read");

  expect(writeResponse).not.toHaveBeenCalled();
  expect(createWindow).toHaveBeenCalledOnce();
  expect(closePane).toHaveBeenCalledWith(child.paneId);
});

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

test("missing managed window quietly stops later title updates", async () => {
  vi.spyOn(Tmux, "createWindow").mockResolvedValue({
    paneId: child.paneId,
    windowId: child.windowId,
  });
  vi.spyOn(Tmux, "markManagedPane").mockResolvedValue();
  const selectedPane = vi
    .spyOn(Tmux, "selectedPaneId")
    .mockResolvedValue({ missing: true });
  const setTitle = vi
    .spyOn(Tmux, "setAutomaticWindowTitle")
    .mockResolvedValue(undefined);
  vi.spyOn(Tmux, "paneExists").mockReturnValue(true);

  const parent = runtime();
  await parent.launch(child.manifest);
  await vi.waitFor(() => expect(selectedPane).toHaveBeenCalledTimes(1));

  await parent.continue(child.manifest, "Continue after window removal.");
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(selectedPane).toHaveBeenCalledTimes(1);
  expect(setTitle).not.toHaveBeenCalled();
});

test("window disappearing during a title write quietly stops updates", async () => {
  vi.spyOn(Tmux, "createWindow").mockResolvedValue({
    paneId: child.paneId,
    windowId: child.windowId,
  });
  vi.spyOn(Tmux, "markManagedPane").mockResolvedValue();
  const selectedPane = vi
    .spyOn(Tmux, "selectedPaneId")
    .mockResolvedValueOnce({ paneId: child.paneId })
    .mockResolvedValue({ missing: true });
  const setTitle = vi
    .spyOn(Tmux, "setAutomaticWindowTitle")
    .mockResolvedValue("no such window: @1");
  vi.spyOn(Tmux, "paneExists").mockReturnValue(true);

  const parent = runtime();
  await parent.launch(child.manifest);
  await vi.waitFor(() =>
    expect(selectedPane.mock.calls.length).toBeGreaterThanOrEqual(2),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  const callsAfterWindowRemoval = selectedPane.mock.calls.length;

  expect(setTitle).toHaveBeenCalledTimes(1);

  await parent.continue(child.manifest, "Continue after window removal.");
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(selectedPane).toHaveBeenCalledTimes(callsAfterWindowRemoval);
});

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
    getAllTools: () => [{ name: "read" }],
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
  await expect(launch).resolves.toEqual(child.manifest);
  expect(launchResolved).toBe(true);

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
