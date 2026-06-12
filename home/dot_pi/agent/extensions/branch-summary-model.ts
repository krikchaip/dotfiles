/**
 * Branch summary model override for Pi.
 *
 * Configure in ~/.pi/agent/settings.json or <project>/.pi/settings.json:
 * {
 *   "branchSummary": {
 *     "model": "google/gemini-2.5-flash"
 *   }
 * }
 *
 * Use "model" as "provider/model-id" or { "provider": "...", "id": "..." }.
 */

import {
  generateBranchSummary,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const EXTENSION_NAME = "branch-summary-model";

type PiModel = NonNullable<ExtensionContext["model"]>;

type BranchSummaryConfig = {
  model?: unknown;
  reserveTokens?: unknown;
};

type Settings = {
  branchSummary?: BranchSummaryConfig;
};

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

function getBranchSummaryConfig(settings: Settings): BranchSummaryConfig {
  return isRecord(settings.branchSummary) ? settings.branchSummary : {};
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

async function resolveSummaryModel(
  ctx: ExtensionContext,
  config: BranchSummaryConfig,
) {
  if (config.model === undefined) return undefined;

  const ref = parseModelRef(config.model);
  if (!ref) {
    warnOnce(
      ctx,
      "model:invalid",
      `${EXTENSION_NAME}: invalid branchSummary.model; falling back to current model`,
    );
    return undefined;
  }

  const model = ctx.modelRegistry.find(ref.provider, ref.id) as
    | PiModel
    | undefined;
  if (!model) {
    warnOnce(
      ctx,
      `model:not-found:${ref.provider}/${ref.id}`,
      `${EXTENSION_NAME}: branch summary model ${ref.provider}/${ref.id} not found; falling back to current model`,
    );
    return undefined;
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    warnOnce(
      ctx,
      `model:auth:${ref.provider}/${ref.id}`,
      `${EXTENSION_NAME}: branch summary model ${ref.provider}/${ref.id} auth failed: ${auth.error}; falling back to current model`,
    );
    return undefined;
  }

  return { model, auth };
}

export default function (pi: ExtensionAPI) {
  pi.on("session_before_tree", async (event, ctx) => {
    if (!event.preparation.userWantsSummary) return;
    if (event.preparation.entriesToSummarize.length === 0) return;

    const settings = await loadSettings(ctx);
    const config = getBranchSummaryConfig(settings);
    const target = await resolveSummaryModel(ctx, config);
    if (!target) return;

    const focus = event.preparation.customInstructions
      ? `; focus: ${event.preparation.customInstructions}`
      : "";
    notify(
      ctx,
      `${EXTENSION_NAME}: summarizing with ${modelName(target.model)}${focus}`,
      "info",
    );

    try {
      const result = await generateBranchSummary(
        event.preparation.entriesToSummarize,
        {
          model: target.model,
          apiKey: target.auth.apiKey ?? "",
          headers: target.auth.headers,
          signal: event.signal,
          customInstructions: event.preparation.customInstructions,
          replaceInstructions: event.preparation.replaceInstructions,
          reserveTokens: parseTokenValue(config.reserveTokens),
        },
      );

      if (result.aborted) return { cancel: true };
      if (result.error) throw new Error(result.error);

      return {
        summary: {
          summary: result.summary ?? "No summary generated",
          details: {
            readFiles: result.readFiles ?? [],
            modifiedFiles: result.modifiedFiles ?? [],
          },
        },
      };
    } catch (error) {
      if (event.signal.aborted) return { cancel: true };
      notify(
        ctx,
        `${EXTENSION_NAME}: branch summary model ${modelName(target.model)} failed: ${String(error)}; falling back to current model`,
        "warning",
      );
      return;
    }
  });
}
