/**
 * Branch and merge session workflows.
 *
 * /branch \[prompt?\]
 *   Clone the current active branch into a new session. If prompt is provided,
 *   submit it as the first message in the cloned session.
 *
 * /merge \[target-session-id?\] \[instruction?\]
 *   Summarize the current source session and append that summary to the target
 *   session's active leaf.
 */

import {
  DynamicBorder,
  generateBranchSummary,
  SessionManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  SelectList,
  Text,
  type SelectItem,
} from "@earendil-works/pi-tui";
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const EXTENSION_NAME = "branch-merge";
const ACTIVE_LEAF_MARKER = "branch-merge:active-leaf";
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type PiModel = NonNullable<ExtensionContext["model"]>;
type GenerateBranchSummaryOptions = Parameters<typeof generateBranchSummary>[1];
type RequestAuth = Awaited<
  ReturnType<ExtensionContext["modelRegistry"]["getApiKeyAndHeaders"]>
>;
type RequestAuthError = Extract<RequestAuth, { error: string }>;
type CommandSessionManager = ExtensionCommandContext["sessionManager"];
type BranchEntry = ReturnType<CommandSessionManager["getBranch"]>[number];

type BranchSummaryConfig = {
  model?: unknown;
  reserveTokens?: unknown;
};

type Settings = {
  branchSummary?: BranchSummaryConfig;
};

type FileSnapshot = {
  size: number;
  mtimeMs: number;
};

type PostMergeAction = "switch" | "switch-remove" | "stay";

class UserVisibleWarning extends Error {}

const warned = new Set<string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getMarkerLeafId(
  entry: ReturnType<CommandSessionManager["getLeafEntry"]>,
) {
  if (entry?.type !== "custom") return undefined;
  if (entry.customType !== ACTIVE_LEAF_MARKER) return undefined;
  if (!isRecord(entry.data)) return undefined;

  const { leafId } = entry.data;
  if (leafId === null || typeof leafId === "string") return leafId;
  return undefined;
}

function getLogicalLeafId(sessionManager: CommandSessionManager) {
  const markerLeafId = getMarkerLeafId(sessionManager.getLeafEntry());
  return markerLeafId !== undefined ? markerLeafId : sessionManager.getLeafId();
}

function hasConversationEntry(entries: BranchEntry[]) {
  return entries.some(
    (entry) =>
      entry.type === "message" ||
      entry.type === "custom_message" ||
      entry.type === "branch_summary" ||
      entry.type === "compaction",
  );
}

function getBranchableLeafId(sessionManager: CommandSessionManager) {
  const leafId = getLogicalLeafId(sessionManager);
  if (!leafId) return null;
  if (!sessionManager.getEntry(leafId)) return null;
  if (!hasConversationEntry(sessionManager.getBranch(leafId))) return null;
  return leafId;
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

function isRequestAuthError(auth: RequestAuth): auth is RequestAuthError {
  return "error" in auth;
}

async function resolveConfiguredSummaryModel(
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
  if (isRequestAuthError(auth)) {
    warnOnce(
      ctx,
      `model:auth:${ref.provider}/${ref.id}`,
      `${EXTENSION_NAME}: branch summary model ${ref.provider}/${ref.id} auth failed: ${auth.error}; falling back to current model`,
    );
    return undefined;
  }

  return { model, auth };
}

async function resolveCurrentSummaryModel(ctx: ExtensionContext) {
  const model = ctx.model as PiModel | undefined;
  if (!model) throw new Error("No model available for summarization");

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (isRequestAuthError(auth)) {
    throw new Error(`Current model auth failed: ${auth.error}`);
  }

  return { model, auth };
}

async function getSnapshot(path: string): Promise<FileSnapshot> {
  const result = await stat(path);
  return { size: result.size, mtimeMs: result.mtimeMs };
}

function sameSnapshot(a: FileSnapshot, b: FileSnapshot): boolean {
  return a.size === b.size && a.mtimeMs === b.mtimeMs;
}

function parseMergeArgs(args: string) {
  const trimmed = args.trim();
  if (!trimmed) return { instruction: "" };

  const [first = "", ...rest] = trimmed.split(/\s+/);
  if (UUID_RE.test(first)) {
    return { targetSessionId: first, instruction: rest.join(" ") };
  }

  return { instruction: trimmed };
}

async function findSessionById(sessionId: string) {
  const sessions = await SessionManager.listAll();
  return sessions.filter((session) => session.id === sessionId);
}

async function resolveMergeTarget(args: string, ctx: ExtensionCommandContext) {
  const parsed = parseMergeArgs(args);

  if (parsed.targetSessionId) {
    const matches = await findSessionById(parsed.targetSessionId);
    if (matches.length === 0) {
      throw new Error(`No session found with id ${parsed.targetSessionId}`);
    }
    if (matches.length > 1) {
      throw new Error(
        `Multiple sessions found with id ${parsed.targetSessionId}`,
      );
    }
    return { path: matches[0]!.path, instruction: parsed.instruction };
  }

  const parentSession = ctx.sessionManager.getHeader()?.parentSession;
  if (!parentSession) {
    throw new Error(
      "No parent session to merge into. Pass a full session id from /session.",
    );
  }

  return { path: parentSession, instruction: parsed.instruction };
}

function formatSummaryWithMetadata(params: {
  summary: string;
  sourceSessionId: string;
  sourceSessionName?: string;
  sourceSessionFile: string;
  instruction: string;
}) {
  const lines = [
    `Merged from session ${params.sourceSessionId}`,
    params.sourceSessionName
      ? `Source name: ${params.sourceSessionName}`
      : undefined,
    `Source file: ${params.sourceSessionFile}`,
    params.instruction ? `Instruction: ${params.instruction}` : undefined,
    "",
    params.summary,
  ];

  return lines.filter((line) => line !== undefined).join("\n");
}

async function generateMergeSummary(
  ctx: ExtensionCommandContext,
  instruction: string,
) {
  const sourceLeafId = getLogicalLeafId(ctx.sessionManager);
  const entries = sourceLeafId
    ? ctx.sessionManager.getBranch(sourceLeafId)
    : [];
  if (entries.length === 0 || !hasConversationEntry(entries)) {
    throw new UserVisibleWarning("Nothing to merge yet");
  }

  const settings = await loadSettings(ctx);
  const config = getBranchSummaryConfig(settings);
  const reserveTokens = parseTokenValue(config.reserveTokens);
  const controller = new AbortController();
  const configured = await resolveConfiguredSummaryModel(ctx, config);

  const run = async (
    target: Awaited<ReturnType<typeof resolveCurrentSummaryModel>>,
  ) => {
    notify(
      ctx,
      `${EXTENSION_NAME}: summarizing with ${modelName(target.model)}`,
      "info",
    );
    const options: GenerateBranchSummaryOptions = {
      model: target.model,
      apiKey: target.auth.apiKey ?? "",
      signal: controller.signal,
    };
    if (target.auth.headers) options.headers = target.auth.headers;
    if (instruction) options.customInstructions = instruction;
    if (reserveTokens !== undefined) options.reserveTokens = reserveTokens;

    const result = await generateBranchSummary(entries, options);

    if (result.aborted) throw new Error("Branch summary cancelled");
    if (result.error) throw new Error(result.error);

    return {
      summary: result.summary ?? "No summary generated",
      details: {
        readFiles: result.readFiles ?? [],
        modifiedFiles: result.modifiedFiles ?? [],
      },
    };
  };

  if (configured) {
    try {
      return await run(configured);
    } catch (error) {
      notify(
        ctx,
        `${EXTENSION_NAME}: branch summary model ${modelName(configured.model)} failed: ${String(error)}; falling back to current model`,
        "warning",
      );
    }
  }

  return run(await resolveCurrentSummaryModel(ctx));
}

async function choosePostMergeAction(ctx: ExtensionCommandContext) {
  if (ctx.mode !== "tui") return "switch" satisfies PostMergeAction;

  const items: SelectItem[] = [
    {
      value: "switch",
      label: "Switch to target",
      description: "Jump to the merged session",
    },
    {
      value: "switch-remove",
      label: "Switch to target and remove source",
      description: "Jump to target, then move this source session to Trash",
    },
    {
      value: "stay",
      label: "Stay in source",
      description: "Keep working here after writing the merge summary",
    },
  ];

  const result = await ctx.ui.custom<PostMergeAction | null>(
    (tui, theme, _keybindings, done) => {
      const container = new Container();
      container.addChild(
        new DynamicBorder((s: string) => theme.fg("accent", s)),
      );
      container.addChild(
        new Text(theme.fg("accent", theme.bold("Merge complete")), 1, 0),
      );
      container.addChild(
        new Text(
          theme.fg(
            "dim",
            "Choose what to do next. Press 1-3 or use ↑↓ + Enter.",
          ),
          1,
          0,
        ),
      );

      const selectList = new SelectList(items, items.length, {
        selectedPrefix: (text: string) => theme.fg("accent", text),
        selectedText: (text: string) => theme.fg("accent", text),
        description: (text: string) => theme.fg("muted", text),
        scrollInfo: (text: string) => theme.fg("dim", text),
        noMatch: (text: string) => theme.fg("warning", text),
      });
      selectList.onSelect = (item) => done(item.value as PostMergeAction);
      selectList.onCancel = () => done(null);
      container.addChild(selectList);
      container.addChild(
        new DynamicBorder((s: string) => theme.fg("accent", s)),
      );

      return {
        render: (width: number) => container.render(width),
        invalidate: () => container.invalidate(),
        handleInput: (data: string) => {
          if (data >= "1" && data <= String(items.length)) {
            done(items[Number(data) - 1]!.value as PostMergeAction);
            return;
          }
          selectList.handleInput(data);
          tui.requestRender();
        },
      };
    },
    { overlay: true },
  );

  return result ?? "switch";
}

async function trashSessionFile(path: string, ctx: ExtensionContext) {
  await new Promise<void>((resolvePromise) => {
    const child = spawn("trash", [path], { stdio: "ignore" });

    child.on("error", (error) => {
      notify(
        ctx,
        `${EXTENSION_NAME}: trash failed; source session kept: ${String(error)}`,
        "warning",
      );
      resolvePromise();
    });

    child.on("exit", (code) => {
      if (code === 0) {
        notify(ctx, `${EXTENSION_NAME}: source session moved to Trash`, "info");
      } else {
        notify(
          ctx,
          `${EXTENSION_NAME}: trash exited with code ${code}; source session kept`,
          "warning",
        );
      }
      resolvePromise();
    });
  });
}

async function merge(args: string, ctx: ExtensionCommandContext) {
  await ctx.waitForIdle();

  const sourceSessionFile = ctx.sessionManager.getSessionFile();
  if (!sourceSessionFile) throw new Error("Cannot merge an in-memory session");

  const sourceSessionId = ctx.sessionManager.getSessionId();
  const sourceSessionName = ctx.sessionManager.getSessionName();
  const target = await resolveMergeTarget(args, ctx);
  const targetPath = resolve(target.path);

  if (resolve(sourceSessionFile) === targetPath) {
    throw new Error("Cannot merge a session into itself");
  }

  const before = await getSnapshot(targetPath);
  const generated = await generateMergeSummary(ctx, target.instruction);
  const after = await getSnapshot(targetPath);

  if (!sameSnapshot(before, after)) {
    throw new Error("Target session changed during merge. Re-run /merge.");
  }

  const targetSession = SessionManager.open(targetPath);
  const targetLeafId = targetSession.getLeafId();
  const summaryParams: Parameters<typeof formatSummaryWithMetadata>[0] = {
    summary: generated.summary,
    sourceSessionId,
    sourceSessionFile,
    instruction: target.instruction,
  };
  if (sourceSessionName) summaryParams.sourceSessionName = sourceSessionName;

  const summary = formatSummaryWithMetadata(summaryParams);
  const details: Record<string, unknown> = {
    ...generated.details,
    sourceSessionId,
    sourceSessionFile,
  };
  if (sourceSessionName) details.sourceSessionName = sourceSessionName;
  if (target.instruction) details.instruction = target.instruction;

  targetSession.branchWithSummary(targetLeafId, summary, details, true);

  const action = await choosePostMergeAction(ctx);
  if (action === "stay") {
    notify(ctx, `${EXTENSION_NAME}: merged into target session`, "info");
    return;
  }

  if (action === "switch-remove") {
    const result = await ctx.switchSession(targetPath, {
      withSession: async (newCtx) => {
        void trashSessionFile(sourceSessionFile, newCtx);
      },
    });
    if (result.cancelled)
      notify(ctx, `${EXTENSION_NAME}: switch cancelled`, "warning");
    return;
  }

  const result = await ctx.switchSession(targetPath);
  if (result.cancelled)
    notify(ctx, `${EXTENSION_NAME}: switch cancelled`, "warning");
}

export default function (pi: ExtensionAPI) {
  pi.on("session_tree", async (event) => {
    if (!event.newLeafId) return;

    pi.appendEntry(ACTIVE_LEAF_MARKER, {
      version: 1,
      leafId: event.newLeafId,
      timestamp: Date.now(),
    });
  });

  pi.registerCommand("branch", {
    description: "Clone current session branch and optionally submit a prompt",
    handler: async (args, ctx) => {
      try {
        await ctx.waitForIdle();

        const leafId = getBranchableLeafId(ctx.sessionManager);
        if (!leafId) {
          notify(ctx, "Nothing to clone yet", "warning");
          return;
        }

        const prompt = args.trim();
        const options: Parameters<typeof ctx.fork>[1] = { position: "at" };
        if (prompt) {
          options.withSession = async (newCtx) => {
            await newCtx.sendUserMessage(prompt);
          };
        }

        const result = await ctx.fork(leafId, options);

        if (result.cancelled)
          notify(ctx, `${EXTENSION_NAME}: branch cancelled`, "warning");
      } catch (error) {
        notify(
          ctx,
          `${EXTENSION_NAME}: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      }
    },
  });

  pi.registerCommand("merge", {
    description: "Summarize current session into parent or target session",
    handler: async (args, ctx) => {
      try {
        await merge(args, ctx);
      } catch (error) {
        notify(
          ctx,
          `${EXTENSION_NAME}: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof UserVisibleWarning ? "warning" : "error",
        );
      }
    },
  });
}
