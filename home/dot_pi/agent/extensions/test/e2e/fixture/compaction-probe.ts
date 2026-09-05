import {
  AgentSession,
  InteractiveMode,
  calculateContextTokens,
  estimateTokens,
  type ExtensionAPI,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";

const mode = process.env.PI_E2E_COMPACTION_PROBE;
const AUTO_PATCH = Symbol.for("auto-compact.turn-boundary");
const CONTEXT_PATCH = Symbol.for("post-compaction-context.patch");
const DEDUP_PATCH = "__dedupCompactionBannerPatchState";
const MARKER = "\u0000auto-compact:turn-boundary";
const CONTINUE_MARKER = `${MARKER}:continue`;

type RecordLike = Record<PropertyKey, unknown>;

type ProbeAgentSession = {
  __compactionProbe: true;
  agent: RecordLike;
  compactCalls: Array<string | undefined>;
  runCalls: unknown[][];
  sessionManager: { getBranch(): SessionEntry[] };
  waitForIdle(): Promise<void>;
};

type ProbeInteractiveMode = {
  __compactionProbe: true;
  added: unknown[];
  initialEntries?: SessionEntry[];
  renderedEntries?: SessionEntry[];
  sessionManager: { getEntries(): SessionEntry[] };
};

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function entry(
  type: string,
  id: string,
  parentId: string | null,
  seconds: number,
  extra: Record<string, unknown> = {},
): SessionEntry {
  return {
    type,
    id,
    parentId,
    timestamp: new Date(Date.UTC(2025, 0, 1, 0, 0, seconds)).toISOString(),
    ...extra,
  } as SessionEntry;
}

function installAutoCompactSentinels(): void {
  const prototype = AgentSession.prototype as unknown as RecordLike;
  const originalCompact = prototype.compact as (...args: unknown[]) => unknown;
  const originalRun = prototype._runAgentPrompt as (...args: unknown[]) => unknown;
  const originalPostRun = prototype._handlePostAgentRun as (...args: unknown[]) => unknown;

  prototype.compact = function (this: ProbeAgentSession, instructions?: string) {
    if (!this.__compactionProbe) return originalCompact.call(this, instructions);
    this.compactCalls.push(instructions);
    return Promise.resolve({
      summary: "ORIGINAL COMPACTION",
      firstKeptEntryId: "kept",
      tokensBefore: 20,
    });
  };
  prototype._runAgentPrompt = function (this: ProbeAgentSession, messages: unknown[]) {
    if (!this.__compactionProbe) return originalRun.call(this, messages);
    this.runCalls.push(messages);
    return Promise.resolve();
  };
  prototype._handlePostAgentRun = function (this: ProbeAgentSession) {
    if (!this.__compactionProbe) return originalPostRun.call(this);
    const hasQueuedMessages = this.agent.hasQueuedMessages as
      | (() => boolean)
      | undefined;
    return Promise.resolve(hasQueuedMessages?.() === true);
  };
}

function installContextUsageSentinel(): void {
  const prototype = AgentSession.prototype;
  const original = prototype.getContextUsage;
  prototype.getContextUsage = function () {
    if ((this as unknown as { __compactionProbe?: boolean }).__compactionProbe) {
      return { tokens: 777, contextWindow: 999, percent: 77.7 };
    }
    return original.call(this);
  };
}

function installDedupSentinels(): void {
  const prototype = InteractiveMode.prototype as unknown as RecordLike;
  const originalAdd = prototype.addMessageToChat as (...args: unknown[]) => unknown;
  const originalInitial = prototype.renderInitialMessages as (...args: unknown[]) => unknown;
  const originalEntries = prototype.renderSessionEntries as (...args: unknown[]) => unknown;

  prototype.addMessageToChat = function (this: ProbeInteractiveMode, message: unknown) {
    if (!this.__compactionProbe) return originalAdd.call(this, message);
    this.added.push(message);
  };
  prototype.renderInitialMessages = function (this: ProbeInteractiveMode) {
    if (!this.__compactionProbe) return originalInitial.call(this);
    this.initialEntries = this.sessionManager.getEntries();
  };
  prototype.renderSessionEntries = function (
    this: ProbeInteractiveMode,
    entries: SessionEntry[],
  ) {
    if (!this.__compactionProbe) return originalEntries.call(this, entries);
    this.renderedEntries = entries;
  };
}

if (mode === "auto-compact") installAutoCompactSentinels();
if (mode === "post-compaction-context") installContextUsageSentinel();
if (mode === "dedup-compaction-banner") installDedupSentinels();

async function testAutoCompact(): Promise<void> {
  const prototype = AgentSession.prototype as unknown as RecordLike;
  const patch = prototype[AUTO_PATCH] as { version?: number } | undefined;
  check(patch?.version === 3, "turn-boundary patch version is not 3");

  let branch: SessionEntry[] = [];
  const steering = ["STEERING"];
  const followUp = ["FOLLOW-UP"];
  const fake: ProbeAgentSession = {
    __compactionProbe: true,
    compactCalls: [],
    runCalls: [],
    sessionManager: { getBranch: () => branch },
    waitForIdle: async () => {},
    agent: {
      createLoopConfig: () => ({}),
      hasQueuedMessages: () => false,
      steeringQueue: { drain: () => steering.splice(0) },
      followUpQueue: { drain: () => followUp.splice(0) },
      state: { isStreaming: false },
    },
  };
  const compact = prototype.compact as (
    this: ProbeAgentSession,
    instructions?: string,
  ) => Promise<{ summary: string }>;

  await compact.call(fake, "manual focus");
  check(fake.compactCalls.at(-1) === "manual focus", "manual focus was not preserved");

  await compact.call(fake, `${MARKER}:after-compaction=none`);
  check(fake.compactCalls.at(-1) === undefined, "settled marker did not fall back to normal compact");

  let rejected = false;
  try {
    await compact.call(fake, `${CONTINUE_MARKER}:after-compaction=none`);
  } catch (error) {
    rejected = String(error).includes("outside an active run");
  }
  check(rejected, "continuation marker did not reject outside an active run");

  const run = prototype._runAgentPrompt as (
    this: ProbeAgentSession,
    messages: unknown[],
  ) => Promise<void>;
  (fake.agent.state as { isStreaming: boolean }).isStreaming = true;
  await run.call(fake, []);
  (fake.agent.createLoopConfig as () => unknown)();
  fake.waitForIdle = async () => {
    branch = [
      entry("compaction", "new-compaction", null, 1, {
        summary: "BUILT IN WON",
        firstKeptEntryId: "kept",
        tokensBefore: 99,
      }),
    ];
  };
  const callsBeforeSupersession = fake.compactCalls.length;
  const superseded = await compact.call(fake, `${MARKER}:after-compaction=old-compaction`);
  check(superseded.summary === "BUILT IN WON", "built-in compaction result was not reused");
  check(
    fake.compactCalls.length === callsBeforeSupersession,
    "superseded early compaction called core compact again",
  );

  branch = [];
  fake.waitForIdle = async () => {};
  (fake.agent.hasQueuedMessages as unknown) = () => true;
  const runCallsBeforeQueue = fake.runCalls.length;
  await compact.call(fake, `${MARKER}:after-compaction=none`);
  check(fake.runCalls.length === runCallsBeforeQueue + 1, "queued steering was not resumed");
  check(fake.runCalls.at(-1)?.[0] === "STEERING", "steering queue was not preferred");
  await compact.call(fake, `${MARKER}:after-compaction=none`);
  check(fake.runCalls.at(-1)?.[0] === "FOLLOW-UP", "follow-up queue was not resumed");
}

function compactionEntry(id = "compact"): SessionEntry {
  return entry("compaction", id, "before", 2, {
    summary: "SUMMARY",
    firstKeptEntryId: "after",
    tokensBefore: 100,
  });
}

function assistantEntry(
  id: string,
  stopReason: "stop" | "aborted" | "error",
  input: number,
): SessionEntry {
  const timestamp = Date.UTC(2025, 0, 1, 0, 0, 3);
  return entry("message", id, "compact", 3, {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "after" }],
      api: "openai-completions",
      provider: "probe",
      model: "fake",
      usage: {
        input,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: input + 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason,
      timestamp,
    },
  });
}

function testPostCompactionContext(): void {
  const prototype = AgentSession.prototype as unknown as RecordLike;
  check(Boolean(prototype[CONTEXT_PATCH]), "context usage patch state is absent");
  const getUsage = prototype.getContextUsage as (this: RecordLike) => {
    tokens: number;
    contextWindow: number;
  };
  const messages = [
    { role: "user", content: [{ type: "text", text: "estimate this message" }], timestamp: 1 },
  ];
  let branch: SessionEntry[] = [compactionEntry()];
  const fake: RecordLike = {
    __compactionProbe: true,
    model: { contextWindow: 8_192 },
    messages,
    sessionManager: { getBranch: () => branch },
  };

  let usage = getUsage.call(fake);
  check(usage.tokens === estimateTokens(messages[0] as never), "post-compaction estimate is wrong");
  check(usage.contextWindow === 8_192, "estimate lost the model context window");

  branch = [compactionEntry(), assistantEntry("aborted", "aborted", 20)];
  usage = getUsage.call(fake);
  check(usage.tokens !== 777, "aborted usage incorrectly ended the estimate gap");

  branch = [compactionEntry(), assistantEntry("error", "error", 20)];
  usage = getUsage.call(fake);
  check(usage.tokens !== 777, "error usage incorrectly ended the estimate gap");

  branch = [compactionEntry(), assistantEntry("zero", "stop", 0)];
  usage = getUsage.call(fake);
  check(usage.tokens === 777, "zero-token completed usage did not end the estimate gap");

  branch = [compactionEntry(), assistantEntry("complete", "stop", 20)];
  const complete = branch[1] as SessionEntry & {
    message: { usage: Parameters<typeof calculateContextTokens>[0] };
  };
  check(calculateContextTokens(complete.message.usage) > 0, "probe usage is invalid");
  usage = getUsage.call(fake);
  check(usage.tokens === 777, "valid post-compaction usage did not restore core result");

  branch = [];
  check(getUsage.call(fake).tokens === 777, "no-compaction path did not use core result");
  fake.model = { contextWindow: 0 };
  check(getUsage.call(fake).tokens === 777, "zero context window did not use core result");
}

function ids(entries: SessionEntry[] | undefined): string[] {
  return (entries ?? []).map((item) => item.id);
}

function testDedupCompactionBanner(): void {
  const prototype = InteractiveMode.prototype as unknown as RecordLike;
  check(Boolean(prototype[DEDUP_PATCH]), "dedup patch state is absent");
  const render = prototype.renderSessionEntries as (
    this: ProbeInteractiveMode,
    entries: SessionEntry[],
  ) => void;
  const renderInitial = prototype.renderInitialMessages as (this: ProbeInteractiveMode) => void;
  const add = prototype.addMessageToChat as (this: ProbeInteractiveMode, message: unknown) => void;

  const before = entry("message", "before", null, 1);
  const compact = compactionEntry();
  const after = entry("message", "after", "compact", 3);
  const laterCompact = compactionEntry("ignored-second-compaction");
  const fake: ProbeInteractiveMode = {
    __compactionProbe: true,
    added: [],
    sessionManager: { getEntries: () => [before, compact, after] },
  };

  render.call(fake, [before, after, compact, laterCompact]);
  const parentPlacement = ids(fake.renderedEntries).join(",");
  check(
    parentPlacement === "before,compact,after",
    `parent placement or dedup failed: ${parentPlacement}`,
  );

  const missingParent = compactionEntry();
  missingParent.parentId = "missing";
  render.call(fake, [before, after, missingParent]);
  check(ids(fake.renderedEntries).join(",") === "before,compact,after", "child placement failed");

  const timeOnly = compactionEntry();
  timeOnly.parentId = "missing";
  const unrelatedAfter = entry("message", "unrelated-after", "other", 3);
  render.call(fake, [before, unrelatedAfter, timeOnly]);
  check(
    ids(fake.renderedEntries).join(",") === "before,compact,unrelated-after",
    "timestamp placement failed",
  );

  const originalGetEntries = fake.sessionManager.getEntries;
  renderInitial.call(fake);
  check(ids(fake.initialEntries).join(",") === "before,after", "initial banner compaction was not hidden");
  check(fake.sessionManager.getEntries === originalGetEntries, "getEntries was not restored");

  fake.added = [];
  const summary = { role: "compactionSummary", summary: "SUMMARY", tokensBefore: 100 };
  add.call(fake, summary);
  add.call(fake, { ...summary });
  add.call(fake, { ...summary, tokensBefore: 101 });
  check(fake.added.length === 2, "live duplicate suppression removed the wrong cards");
}

export default function compactionProbe(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, context) => {
    if (!mode || context.mode !== "tui") return;
    void Promise.resolve()
      .then(async () => {
        if (mode === "auto-compact") await testAutoCompact();
        else if (mode === "post-compaction-context") testPostCompactionContext();
        else if (mode === "dedup-compaction-banner") testDedupCompactionBanner();
        else throw new Error(`unknown compaction probe mode: ${mode}`);
        context.ui.setWidget("compaction-probe", [
          `COMPACTION PROBE PASS ${mode} gemini-ready`,
        ]);
      })
      .catch((error) => {
        context.ui.setWidget("compaction-probe", [`COMPACTION PROBE FAIL ${String(error)}`]);
      });
  });
}
