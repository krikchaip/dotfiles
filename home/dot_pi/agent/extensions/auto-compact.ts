/**
 * Auto-compaction helper for Pi.
 *
 * Adds configurable early compaction thresholds and lets manual/built-in
 * compaction use a configured summarization model while preserving Pi's
 * built-in compaction behavior.
 *
 * Configure in ~/.pi/agent/settings.json or <project>/.pi/settings.json:
 * {
 *   "compaction": {
 *     "enabled": true,
 *     "model": "google/gemini-2.5-flash",
 *     "autoTrigger": {
 *       "enabled": true,
 *       "absoluteTokens": "120k",
 *       "contextWindowFamilies": { "200k": "100k", "400k": "140k", "1m": "200k" }
 *     }
 *   }
 * }
 *
 * Use "model" as "provider/model-id" or { "provider": "...", "id": "..." }.
 * If contextWindowFamilies is non-empty, absoluteTokens is ignored.
 *
 * Value Details:
 * - absoluteTokens: number (e.g. 120000) or string (e.g. "120k", "1.2m").
 * - contextWindowFamilies: object mapping context window floors to thresholds.
 *   - Keys (floors): number or string (e.g. "200k", "1m").
 *   - Values (thresholds): number or string (e.g. "100k", "200k").
 *   - Matches active model context window against largest floor <= window.
 */

import {
  AgentSession,
  compact,
  getLatestCompactionEntry,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const EXTENSION_NAME = "auto-compact";
const MAX_EARLY_BACKOFF_TURNS = 8;
const EARLY_CONTINUATION =
  "Continue from the completed tool results without repeating completed work. Follow any newer user instruction first.";
const EARLY_COMPACTION_MARKER = "\u0000auto-compact:turn-boundary";
const EARLY_COMPACTION_CONTINUE_MARKER = `${EARLY_COMPACTION_MARKER}:continue`;
const EARLY_COMPACTION_BASELINE = ":after-compaction=";
const NO_COMPACTION_BASELINE = "none";
const TURN_BOUNDARY_PATCH = Symbol.for(`${EXTENSION_NAME}.turn-boundary`);
const TURN_BOUNDARY_PATCH_VERSION = 3;

type PiModel = NonNullable<ExtensionContext["model"]>;

type AutoTriggerConfig = {
  enabled?: unknown;
  absoluteTokens?: unknown;
  contextWindowFamilies?: unknown;
};

type CompactionConfig = {
  enabled?: unknown;
  model?: unknown;
  autoTrigger?: AutoTriggerConfig;
};

type Settings = {
  compaction?: CompactionConfig;
};

type Threshold = {
  tokens: number;
  source: string;
};

let earlyAutoInFlight = false;
let allowEarlyAfterCompaction = true;
let postCompactionUsagePending = false;
let earlyAutoDisabledForBranch = false;
let stuckWarningShown = false;
let earlyFailureCount = 0;
let earlyBackoffTurnsRemaining = 0;
let pendingEarlyReason: string | undefined;
let lastCompactionNotice: string | undefined;

const warned = new Set<string>();

type AgentLoopConfig = {
  shouldStopAfterTurn?: (turn: unknown) => boolean | Promise<boolean>;
};

type AgentMessageQueue = {
  drain: () => unknown[];
};

type AgentLike = {
  createLoopConfig: (...args: unknown[]) => AgentLoopConfig;
  hasQueuedMessages: () => boolean;
  steeringQueue?: AgentMessageQueue;
  followUpQueue?: AgentMessageQueue;
  state: { isStreaming: boolean };
  [TURN_BOUNDARY_PATCH]?: AgentTurnBoundaryState;
};

type AgentTurnBoundaryState = {
  originalCreateLoopConfig: AgentLike["createLoopConfig"];
  canStopCurrentRun: boolean;
  stopAfterTurn: boolean;
};

type RunAgentPrompt = (messages: unknown[]) => Promise<void>;
type HandlePostAgentRun = () => Promise<boolean>;

type CoreAgentSession = {
  agent: AgentSession["agent"];
  sessionManager: AgentSession["sessionManager"];
  waitForIdle: AgentSession["waitForIdle"];
  _runAgentPrompt: RunAgentPrompt;
  _handlePostAgentRun: HandlePostAgentRun;
  compact: AgentSession["compact"];
};

type AgentSessionPatch = {
  version?: number;
  originalRunAgentPrompt: RunAgentPrompt;
  originalHandlePostAgentRun?: HandlePostAgentRun;
  originalCompact: AgentSession["compact"];
};

type PatchedAgentSessionPrototype = CoreAgentSession & {
  [TURN_BOUNDARY_PATCH]?: AgentSessionPatch;
};

type EarlyCompactionMarker = {
  continueCurrentWork: boolean;
  baselineCompactionId: string | null | undefined;
};

function createEarlyCompactionMarker(
  continueCurrentWork: boolean,
  baselineCompactionId: string | undefined,
): string {
  const prefix = continueCurrentWork
    ? EARLY_COMPACTION_CONTINUE_MARKER
    : EARLY_COMPACTION_MARKER;
  return `${prefix}${EARLY_COMPACTION_BASELINE}${baselineCompactionId ?? NO_COMPACTION_BASELINE}`;
}

function parseEarlyCompactionMarker(
  customInstructions: string | undefined,
): EarlyCompactionMarker | undefined {
  if (!customInstructions) return undefined;

  const continueCurrentWork = customInstructions.startsWith(
    EARLY_COMPACTION_CONTINUE_MARKER,
  );
  const prefix = continueCurrentWork
    ? EARLY_COMPACTION_CONTINUE_MARKER
    : EARLY_COMPACTION_MARKER;
  if (customInstructions === prefix) {
    return { continueCurrentWork, baselineCompactionId: undefined };
  }

  const encodedBaseline = customInstructions.slice(
    `${prefix}${EARLY_COMPACTION_BASELINE}`.length,
  );
  if (
    !customInstructions.startsWith(`${prefix}${EARLY_COMPACTION_BASELINE}`) ||
    !encodedBaseline
  )
    return undefined;

  return {
    continueCurrentWork,
    baselineCompactionId:
      encodedBaseline === NO_COMPACTION_BASELINE ? null : encodedBaseline,
  };
}

function installAgentTurnStop(agent: AgentLike) {
  if (agent[TURN_BOUNDARY_PATCH]) return;

  const originalCreateLoopConfig = agent.createLoopConfig;
  const state: AgentTurnBoundaryState = {
    originalCreateLoopConfig,
    canStopCurrentRun: false,
    stopAfterTurn: false,
  };
  agent[TURN_BOUNDARY_PATCH] = state;

  agent.createLoopConfig = function patchedCreateLoopConfig(...args) {
    const config = originalCreateLoopConfig.apply(this, args);
    const originalShouldStopAfterTurn = config.shouldStopAfterTurn;
    state.canStopCurrentRun = true;

    return {
      ...config,
      shouldStopAfterTurn: async (turn) => {
        if (state.stopAfterTurn) return true;
        return (await originalShouldStopAfterTurn?.(turn)) ?? false;
      },
    };
  };
}

function drainNextAgentQueue(agent: AgentLike): unknown[] {
  const steering = agent.steeringQueue?.drain() ?? [];
  if (steering.length > 0) return steering;
  return agent.followUpQueue?.drain() ?? [];
}

function installTurnBoundaryCompactionPatch() {
  const prototype =
    AgentSession.prototype as unknown as PatchedAgentSessionPrototype;
  const existing = prototype[TURN_BOUNDARY_PATCH];
  if (existing?.version === TURN_BOUNDARY_PATCH_VERSION) return;

  // Reloads must replace stale wrappers while retaining the original core methods.
  const originalRunAgentPrompt =
    existing?.originalRunAgentPrompt ?? prototype._runAgentPrompt;
  const originalHandlePostAgentRun =
    existing?.originalHandlePostAgentRun ?? prototype._handlePostAgentRun;
  const originalCompact = existing?.originalCompact ?? prototype.compact;
  prototype[TURN_BOUNDARY_PATCH] = {
    version: TURN_BOUNDARY_PATCH_VERSION,
    originalRunAgentPrompt,
    originalHandlePostAgentRun,
    originalCompact,
  };

  prototype._runAgentPrompt = function patchedRunAgentPrompt(...args) {
    installAgentTurnStop(this.agent as unknown as AgentLike);
    return originalRunAgentPrompt.apply(this, args);
  };

  prototype._handlePostAgentRun = async function patchedHandlePostAgentRun(
    ...args
  ) {
    const agent = this.agent as unknown as AgentLike;
    const state = agent[TURN_BOUNDARY_PATCH];
    if (!state?.stopAfterTurn) {
      return originalHandlePostAgentRun.apply(this, args);
    }

    // AgentSession normally restarts the provider loop when agent-level custom
    // messages are queued. Hide only that final queue check so compaction gets
    // the strict turn boundary; retries and built-in compaction still run.
    const hadOwnHasQueuedMessages = Object.prototype.hasOwnProperty.call(
      agent,
      "hasQueuedMessages",
    );
    const originalHasQueuedMessages = agent.hasQueuedMessages;
    agent.hasQueuedMessages = () => false;
    try {
      return await originalHandlePostAgentRun.apply(this, args);
    } finally {
      if (hadOwnHasQueuedMessages) {
        agent.hasQueuedMessages = originalHasQueuedMessages;
      } else {
        Reflect.deleteProperty(agent, "hasQueuedMessages");
      }
    }
  };

  prototype.compact = function patchedCompact(customInstructions) {
    const marker = parseEarlyCompactionMarker(customInstructions);
    if (!marker) return originalCompact.call(this, customInstructions);

    const { continueCurrentWork } = marker;
    const agent = this.agent as unknown as AgentLike;
    installAgentTurnStop(agent);
    const state = agent[TURN_BOUNDARY_PATCH]!;
    if (!agent.state.isStreaming || !state.canStopCurrentRun) {
      return Promise.reject(
        new Error("turn-boundary compaction unavailable outside an active run"),
      );
    }

    state.stopAfterTurn = true;
    return (async () => {
      await this.waitForIdle();
      state.stopAfterTurn = false;

      // Pi's built-in threshold may compact the same turn while this request
      // waits for the strict boundary. Reuse that result instead of issuing a
      // second compaction that can only fail with "Already compacted".
      const latestCompaction = getLatestCompactionEntry(
        this.sessionManager.getBranch(),
      );
      const wasSuperseded =
        marker.baselineCompactionId !== undefined &&
        latestCompaction?.id !== marker.baselineCompactionId;
      const result =
        wasSuperseded && latestCompaction
          ? {
              summary: latestCompaction.summary,
              firstKeptEntryId: latestCompaction.firstKeptEntryId,
              tokensBefore: latestCompaction.tokensBefore,
              usage: latestCompaction.usage,
              details: latestCompaction.details,
            }
          : await originalCompact.call(this);

      // A final answer does not need a synthetic continuation, but custom
      // messages queued during its turn still need a session-managed run.
      if (!continueCurrentWork && agent.hasQueuedMessages()) {
        const queuedMessages = drainNextAgentQueue(agent);
        if (queuedMessages.length > 0) {
          await originalRunAgentPrompt.call(this, queuedMessages);
        }
      }

      return result;
    })();
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function notify(
  ctx: ExtensionContext,
  message: string,
  level: "info" | "warning" | "error" = "info",
) {
  if (ctx.hasUI) ctx.ui.notify(message, level);
}

function warnOnce(ctx: ExtensionContext, key: string, message: string) {
  if (warned.has(key)) return;
  warned.add(key);
  notify(ctx, message, "warning");
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isRecord(base) || !isRecord(override)) return override ?? base;

  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = deepMerge(result[key], value);
  }
  return result;
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return undefined;
    throw error;
  }
}

async function loadSettings(ctx: ExtensionContext): Promise<Settings> {
  const globalPath = join(homedir(), ".pi", "agent", "settings.json");
  const projectPath = join(ctx.cwd, ".pi", "settings.json");

  let merged: unknown = undefined;
  try {
    merged = await readJson(globalPath);
  } catch (error) {
    warnOnce(
      ctx,
      `settings:${globalPath}`,
      `${EXTENSION_NAME}: failed to read ${globalPath}: ${String(error)}`,
    );
  }

  if (ctx.isProjectTrusted()) {
    try {
      merged = deepMerge(merged, await readJson(projectPath));
    } catch (error) {
      warnOnce(
        ctx,
        `settings:${projectPath}`,
        `${EXTENSION_NAME}: failed to read ${projectPath}: ${String(error)}`,
      );
    }
  }

  return isRecord(merged) ? (merged as Settings) : {};
}

function getCompactionConfig(settings: Settings): CompactionConfig {
  return isRecord(settings.compaction) ? settings.compaction : {};
}

function parseTokenValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0)
    return Math.floor(value);
  if (typeof value !== "string") return undefined;

  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll("_", "")
    .replaceAll(",", "");
  const match = normalized.match(/^(\d+(?:\.\d+)?)([km])?$/);
  if (!match) return undefined;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;

  const multiplier =
    match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1;
  return Math.floor(amount * multiplier);
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}m`;
  if (tokens >= 1_000) return `${Number((tokens / 1_000).toFixed(1))}k`;
  return String(tokens);
}

function parseModelRef(
  value: unknown,
): { provider: string; id: string } | undefined {
  if (typeof value === "string") {
    const slash = value.indexOf("/");
    if (slash <= 0 || slash === value.length - 1) return undefined;
    return { provider: value.slice(0, slash), id: value.slice(slash + 1) };
  }

  if (!isRecord(value)) return undefined;
  if (typeof value.provider !== "string" || typeof value.id !== "string")
    return undefined;
  if (!value.provider || !value.id) return undefined;
  return { provider: value.provider, id: value.id };
}

function modelName(model: PiModel): string {
  return `${model.provider}/${model.id}`;
}

function sameModel(a: PiModel | undefined, b: PiModel | undefined): boolean {
  return Boolean(a && b && a.provider === b.provider && a.id === b.id);
}

function resolveThreshold(
  ctx: ExtensionContext,
  config: CompactionConfig,
): Threshold | undefined {
  if (config.enabled === false) return undefined;

  const autoTrigger = isRecord(config.autoTrigger)
    ? config.autoTrigger
    : undefined;
  if (autoTrigger?.enabled !== true) return undefined;

  const families = autoTrigger.contextWindowFamilies;
  if (isRecord(families) && Object.keys(families).length > 0) {
    const contextWindow = ctx.model?.contextWindow;
    if (!contextWindow) return undefined;

    let bestFloor = 0;
    let bestThreshold: number | undefined;
    for (const [rawFloor, rawThreshold] of Object.entries(families)) {
      const floor = parseTokenValue(rawFloor);
      const threshold = parseTokenValue(rawThreshold);
      if (!floor || !threshold) {
        warnOnce(
          ctx,
          `threshold:${rawFloor}`,
          `${EXTENSION_NAME}: invalid contextWindowFamilies entry ${rawFloor}:${String(rawThreshold)}`,
        );
        continue;
      }
      if (floor <= contextWindow && floor >= bestFloor) {
        bestFloor = floor;
        bestThreshold = threshold;
      }
    }

    if (!bestThreshold) return undefined;
    return {
      tokens: bestThreshold,
      source: `contextWindowFamilies ${formatTokens(bestFloor)} -> ${formatTokens(bestThreshold)}`,
    };
  }

  const absoluteTokens = parseTokenValue(autoTrigger?.absoluteTokens);
  if (!absoluteTokens) return undefined;
  return {
    tokens: absoluteTokens,
    source: `absoluteTokens ${formatTokens(absoluteTokens)}`,
  };
}

async function resolveConfiguredModel(
  ctx: ExtensionContext,
  config: CompactionConfig,
): Promise<PiModel | undefined> {
  if (config.model === undefined) return ctx.model;

  const ref = parseModelRef(config.model);
  if (!ref) {
    warnOnce(
      ctx,
      "model:invalid",
      `${EXTENSION_NAME}: invalid compaction.model; falling back to current model`,
    );
    return ctx.model;
  }

  const model = ctx.modelRegistry.find(ref.provider, ref.id) as
    | PiModel
    | undefined;
  if (!model) {
    warnOnce(
      ctx,
      `model:not-found:${ref.provider}/${ref.id}`,
      `${EXTENSION_NAME}: compact model ${ref.provider}/${ref.id} not found; falling back to current model`,
    );
    return ctx.model;
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    warnOnce(
      ctx,
      `model:auth:${ref.provider}/${ref.id}`,
      `${EXTENSION_NAME}: compact model ${ref.provider}/${ref.id} auth failed: ${auth.error}; falling back to current model`,
    );
    return ctx.model;
  }

  return model;
}

function branchLastEntry(ctx: ExtensionContext) {
  const branch = ctx.sessionManager.getBranch();
  return branch[branch.length - 1];
}

function resetEarlyBackoff() {
  earlyFailureCount = 0;
  earlyBackoffTurnsRemaining = 0;
}

function recordEarlyFailure() {
  earlyFailureCount++;
  earlyBackoffTurnsRemaining = Math.min(
    2 ** (earlyFailureCount - 1),
    MAX_EARLY_BACKOFF_TURNS,
  );
}

function resetBranchState(ctx: ExtensionContext) {
  earlyAutoInFlight = false;
  earlyAutoDisabledForBranch = false;
  stuckWarningShown = false;
  resetEarlyBackoff();
  pendingEarlyReason = undefined;
  postCompactionUsagePending = branchLastEntry(ctx)?.type === "compaction";
  allowEarlyAfterCompaction = !postCompactionUsagePending;
}

async function maybeTriggerEarlyAuto(
  ctx: ExtensionContext,
  continueCurrentWork: boolean,
  continueAfterAttempt: () => void,
) {
  const settings = await loadSettings(ctx);
  const config = getCompactionConfig(settings);
  const threshold = resolveThreshold(ctx, config);
  const tokens = ctx.getContextUsage()?.tokens;

  if (!threshold || tokens === null || tokens === undefined) return;
  if (tokens < threshold.tokens) {
    resetEarlyBackoff();
    return;
  }
  if (earlyAutoInFlight || earlyAutoDisabledForBranch) return;
  if (!allowEarlyAfterCompaction || branchLastEntry(ctx)?.type === "compaction")
    return;
  if (ctx.hasPendingMessages()) return;
  if (earlyBackoffTurnsRemaining > 0) {
    earlyBackoffTurnsRemaining--;
    return;
  }

  pendingEarlyReason = `${formatTokens(tokens)} >= ${formatTokens(threshold.tokens)} (${threshold.source})`;
  notify(ctx, `auto-compact threshold reached: ${pendingEarlyReason}`, "info");

  earlyAutoInFlight = true;
  const baselineCompactionId = getLatestCompactionEntry(
    ctx.sessionManager.getBranch(),
  )?.id;
  ctx.compact({
    customInstructions: createEarlyCompactionMarker(
      continueCurrentWork,
      baselineCompactionId,
    ),
    onComplete: () => {
      earlyAutoInFlight = false;
      resetEarlyBackoff();
      pendingEarlyReason = undefined;
      continueAfterAttempt();
    },
    onError: (error) => {
      earlyAutoInFlight = false;
      recordEarlyFailure();
      pendingEarlyReason = undefined;
      notify(ctx, `[${EXTENSION_NAME}] ${error.message}`, "error");
      continueAfterAttempt();
    },
  });
}

async function checkStuckThreshold(ctx: ExtensionContext) {
  const settings = await loadSettings(ctx);
  const config = getCompactionConfig(settings);
  const threshold = resolveThreshold(ctx, config);
  const tokens = ctx.getContextUsage()?.tokens;

  if (
    !threshold ||
    tokens === null ||
    tokens === undefined ||
    tokens < threshold.tokens
  )
    return;

  earlyAutoDisabledForBranch = true;
  if (stuckWarningShown) return;

  stuckWarningShown = true;
  notify(
    ctx,
    `[${EXTENSION_NAME}] context still above early threshold after compaction (${formatTokens(tokens)} >= ${formatTokens(
      threshold.tokens,
    )}). Early auto-compact disabled for this branch. Consider a handoff doc, /fork, /new, higher threshold, or lower keepRecentTokens.`,
    "warning",
  );
}

function builtInThresholdText(
  ctx: ExtensionContext,
  reserveTokens: number,
  tokensBefore: number,
): string | undefined {
  const contextWindow = ctx.model?.contextWindow;
  if (!contextWindow) return undefined;

  const threshold = contextWindow - reserveTokens;
  if (tokensBefore <= threshold) return undefined;
  return `; builtin threshold ${formatTokens(tokensBefore)} > ${formatTokens(threshold)}`;
}

export default function (pi: ExtensionAPI) {
  installTurnBoundaryCompactionPatch();

  let sessionGeneration = 0;
  const terminatingToolCalls = new Set<string>();

  const deferForActiveSession = (
    ctx: ExtensionContext,
    task: (ctx: ExtensionContext) => Promise<void>,
  ) => {
    const generation = sessionGeneration;
    setTimeout(() => {
      if (generation === sessionGeneration) void task(ctx);
    }, 0);
  };

  pi.on("session_start", (_event, ctx) => {
    sessionGeneration++;
    terminatingToolCalls.clear();
    resetBranchState(ctx);
  });

  pi.on("session_shutdown", () => {
    sessionGeneration++;
    terminatingToolCalls.clear();
  });

  pi.on("session_tree", (_event, ctx) => {
    sessionGeneration++;
    terminatingToolCalls.clear();
    resetBranchState(ctx);
  });

  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    if (!postCompactionUsagePending) {
      allowEarlyAfterCompaction = true;
      return;
    }

    postCompactionUsagePending = false;
    deferForActiveSession(ctx, async (activeCtx) => {
      await checkStuckThreshold(activeCtx);
      if (!earlyAutoDisabledForBranch) allowEarlyAfterCompaction = true;
    });
  });

  pi.on("tool_execution_end", (event) => {
    if (event.result?.terminate === true)
      terminatingToolCalls.add(event.toolCallId);
  });

  pi.on("turn_end", async (event, ctx) => {
    const allToolsTerminate =
      event.toolResults.length > 0 &&
      event.toolResults.every((result) =>
        terminatingToolCalls.has(result.toolCallId),
      );
    terminatingToolCalls.clear();

    if (
      event.message.role !== "assistant" ||
      event.message.stopReason === "error" ||
      event.message.stopReason === "aborted"
    )
      return;

    const generation = sessionGeneration;
    const shouldResume = event.toolResults.length > 0 && !allToolsTerminate;
    await maybeTriggerEarlyAuto(ctx, shouldResume, () => {
      deferForActiveSession(ctx, async (activeCtx) => {
        if (
          !shouldResume ||
          generation !== sessionGeneration ||
          activeCtx.hasPendingMessages()
        )
          return;

        pi.sendMessage(
          {
            customType: `${EXTENSION_NAME}-continuation`,
            content: EARLY_CONTINUATION,
            display: false,
          },
          { deliverAs: "followUp", triggerTurn: true },
        );
      });
    });
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const settings = await loadSettings(ctx);
    const config = getCompactionConfig(settings);
    const targetModel = await resolveConfiguredModel(ctx, config);
    const currentModel = ctx.model;

    if (!targetModel) {
      lastCompactionNotice = undefined;
      return;
    }

    const focus = event.customInstructions
      ? `; focus: ${event.customInstructions}`
      : "";
    const earlyReason = pendingEarlyReason
      ? `; early threshold ${pendingEarlyReason}`
      : "";
    const builtinReason =
      builtInThresholdText(
        ctx,
        event.preparation.settings.reserveTokens,
        event.preparation.tokensBefore,
      ) ?? "";
    const noticeSuffix = `${focus}${earlyReason}${builtinReason}`;
    const setCompactionNotice = (model: PiModel | undefined) => {
      lastCompactionNotice = model
        ? `${EXTENSION_NAME}: compacted with ${modelName(model)}${noticeSuffix}`
        : undefined;
    };

    setCompactionNotice(targetModel);
    notify(
      ctx,
      `[${EXTENSION_NAME}] compacting with ${modelName(targetModel)}${noticeSuffix}`,
      "info",
    );
    pendingEarlyReason = undefined;

    if (sameModel(targetModel, currentModel)) return;

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(targetModel);
    if (!auth.ok) {
      setCompactionNotice(currentModel);
      notify(
        ctx,
        `[${EXTENSION_NAME}] compact model ${modelName(targetModel)} auth failed: ${auth.error}; falling back to ${currentModel ? modelName(currentModel) : "current model"}`,
        "warning",
      );
      return;
    }

    try {
      return {
        compaction: await compact(
          event.preparation,
          targetModel,
          auth.apiKey,
          auth.headers,
          event.customInstructions,
          event.signal,
          pi.getThinkingLevel(),
        ),
      };
    } catch (error) {
      if (event.signal.aborted) return { cancel: true };
      setCompactionNotice(currentModel);
      notify(
        ctx,
        `[${EXTENSION_NAME}] compact model ${modelName(targetModel)} failed "${String(error)}"; falling back to ${currentModel ? modelName(currentModel) : "current model"}`,
        "warning",
      );
      return;
    }
  });

  pi.on("session_compact", (_event, ctx) => {
    if (!earlyAutoInFlight) resetEarlyBackoff();
    allowEarlyAfterCompaction = false;
    postCompactionUsagePending = true;
    deferForActiveSession(ctx, async (activeCtx) => {
      if (lastCompactionNotice) notify(activeCtx, lastCompactionNotice, "info");
      lastCompactionNotice = undefined;
    });
  });
}
