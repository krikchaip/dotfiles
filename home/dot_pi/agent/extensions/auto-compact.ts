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
  compact,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const EXTENSION_NAME = "auto-compact";

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
let earlyAutoDisabledForBranch = false;
let stuckWarningShown = false;
let pendingEarlyReason: string | undefined;
let lastCompactionNotice: string | undefined;

const warned = new Set<string>();

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

function resetBranchState(ctx: ExtensionContext) {
  earlyAutoInFlight = false;
  earlyAutoDisabledForBranch = false;
  stuckWarningShown = false;
  pendingEarlyReason = undefined;
  allowEarlyAfterCompaction = branchLastEntry(ctx)?.type !== "compaction";
}

async function maybeTriggerEarlyAuto(ctx: ExtensionContext) {
  const settings = await loadSettings(ctx);
  const config = getCompactionConfig(settings);
  const threshold = resolveThreshold(ctx, config);
  const tokens = ctx.getContextUsage()?.tokens;

  if (!threshold || tokens === null || tokens === undefined) return;
  if (tokens < threshold.tokens) return;
  if (earlyAutoInFlight || earlyAutoDisabledForBranch) return;
  if (!allowEarlyAfterCompaction || branchLastEntry(ctx)?.type === "compaction")
    return;
  if (!ctx.isIdle() || ctx.hasPendingMessages()) return;

  pendingEarlyReason = `${formatTokens(tokens)} >= ${formatTokens(threshold.tokens)} (${threshold.source})`;
  notify(ctx, `auto-compact threshold reached: ${pendingEarlyReason}`, "info");

  earlyAutoInFlight = true;
  ctx.compact({
    onComplete: () => {
      earlyAutoInFlight = false;
      pendingEarlyReason = undefined;
    },
    onError: (error) => {
      earlyAutoInFlight = false;
      pendingEarlyReason = undefined;
      notify(ctx, `[${EXTENSION_NAME}] ${error.message}`, "error");
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
  pi.on("session_start", (_event, ctx) => {
    resetBranchState(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    resetBranchState(ctx);
  });

  pi.on("message_end", (event) => {
    if (event.message.role === "assistant") allowEarlyAfterCompaction = true;
  });

  pi.on("agent_end", (_event, ctx) => {
    setTimeout(() => {
      void maybeTriggerEarlyAuto(ctx);
    }, 0);
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const settings = await loadSettings(ctx);
    const config = getCompactionConfig(settings);
    const targetModel = await resolveConfiguredModel(ctx, config);
    const currentModel = ctx.model;

    if (!targetModel) return;

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
    lastCompactionNotice = `${EXTENSION_NAME}: compacted with ${modelName(targetModel)}${focus}${earlyReason}${builtinReason}`;
    notify(
      ctx,
      `[${EXTENSION_NAME}] compacting with ${modelName(targetModel)}${focus}${earlyReason}${builtinReason}`,
      "info",
    );
    pendingEarlyReason = undefined;

    if (sameModel(targetModel, currentModel)) return;

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(targetModel);
    if (!auth.ok) return;

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
      notify(
        ctx,
        `[${EXTENSION_NAME}] compact model ${modelName(targetModel)} failed "${String(error)}"; falling back to current model`,
        "warning",
      );
      return;
    }
  });

  pi.on("session_compact", (_event, ctx) => {
    earlyAutoInFlight = false;
    allowEarlyAfterCompaction = false;
    setTimeout(() => {
      if (lastCompactionNotice) notify(ctx, lastCompactionNotice, "info");
      lastCompactionNotice = undefined;
      void checkStuckThreshold(ctx);
    }, 0);
  });
}
