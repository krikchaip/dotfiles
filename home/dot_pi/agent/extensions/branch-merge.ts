/**
 * Branch and merge session workflows.
 *
 * /branch \[--vsp|--sp\] \[prompt?\]
 *   With no flag and no prompt, clone the current active branch like /clone.
 *   With a prompt (no flag), switch to the clone and submit that prompt as its
 *   first message.
 *   - Async Execution: Fork submits the prompt asynchronously to prevent the TUI
 *     core editor text clear from wiping typed characters during switch.
 *   - Tmux Pane Split: --vsp splits a side-by-side pane (tmux split-window -h);
 *     --sp splits a top/bottom pane (tmux split-window -v). Split requires a
 *     file-backed source session; in-memory sessions warn and abort. While the
 *     agent streams, split is the only supported branch form: it forks state
 *     immediately before the active branch's latest real user message, leaving
 *     the new editor empty and source streaming uninterrupted. An explicit
 *     prompt is sent only in the new pane. If that user message begins the
 *     session, the child is empty. The branch runs in the new pane by re-exec'ing the same
 *     node + Pi entry this process runs (process.execPath + process.argv\[1\]),
 *     or `pi` when no entry is available, with `--session-dir <dir>` and, for
 *     nonempty branches, `--session <branch-id> [prompt]`. Focus jumps to the
 *     new pane while the source pane
 *     stays on the source session, unchanged. The current process env is
 *     forwarded to the new pane via tmux `-e` (skipping TMUX/TMUX_PANE so tmux
 *     sets the correct pane identity). A split flag outside tmux warns and
 *     aborts (no in-process fallback).
 *
 * /merge \[target-session-id|first-segment?\] \[instruction?\]
 *   Summarize the merge delta from the current source session and append a
 *   branch_summary entry to the target session's active leaf. The merge delta
 *   contains source active-path entries absent from the target active path or
 *   its prior merge watermarks. The target may be
 *   a full UUID or first UUID segment; otherwise the parent session is used.
 *   - Atomic Operations: Target writes (summary and label change) are written
 *     sequentially only after both generation phases succeed.
 *   - Safety Checks: Aborts if target file size or modification time changes
 *     during generation, or if the source session goes non-idle/modified.
 *
 * /pull \<source-session-id|first-segment\> \[instruction?\]
 *   Reverse of /merge: pull a summary from a source session into the current
 *   session. The current session is the merge target. The source session ID or
 *   first UUID segment is required (no default). No post-merge action picker.
 *   - Safety Checks: Same snapshot guards as /merge for both source and target.
 *   - Source active leaf resolved via getLogicalLeafId on opened source file.
 *
 * Configuration settings (in settings.json):
 *   - branchSummary.model: Model to generate summary text (falls back to active model).
 *   - branchSummary.generateLabelModel: Model to generate short label (falls back to summary model).
 *   - branchSummary.reserveTokens: Number of tokens to reserve for summary generation.
 *
 * Title Generation Rules:
 *   - Uses source session name if named and different from target session name.
 *   - Otherwise runs a separate completion with SUMMARY_LABEL_SYSTEM_PROMPT.
 *   - Token budget is fixed at 4096 output tokens (no reasoning configs passed)
 *     to prevent DeepSeek reasoning exhaustion from failing the label call.
 *   - Formatted to 2-8 words, max 60 chars, single line, truncated at word boundary
 *     with Unicode ellipsis "…" if too long. Falls back to source UUID fragment.
 *
 * User Interface & Interaction:
 *   - Above-Editor Spinner: Shows active phase, target/model info, and allows
 *     cancellation through the `app.interrupt` keybinding (typically Esc). An
 *     active overlay or another focused component receives the interrupt first.
 *   - Footer Modal: Choice screen with theme-colored accent borders, target (warning)
 *     and source (success) session IDs. Rows are positional and context-aware:
 *     outside tmux [switch, switch-remove, stay] with the cursor defaulting to
 *     row 1; inside tmux [switch, switch-remove, close-pane, close-pane-remove,
 *     stay] with the cursor defaulting to row 3 (close this pane).
 *   - Short Keys: number keys 1-N map to visible rows, arrow keys navigate,
 *     Enter selects the cursor row, Esc forces stay regardless of cursor.
 *   - Deletion: Moves source session to trash using system CLI `trash` if
 *     selected (best-effort, never blocks the chosen action).
 *   - Pane Close: close-pane / close-pane-remove run `tmux kill-pane` on the
 *     source pane; close-pane-remove also fires a detached best-effort trash.
 */

import {
  generateBranchSummary,
  SessionManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type SessionInfo,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import {
  getKeybindings,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

type PostMergeAction =
  | "switch"
  | "switch-remove"
  | "close-pane"
  | "close-pane-remove"
  | "stay";

type PostMergeItem = {
  value: PostMergeAction;
  label: string;
};

const EXTENSION_NAME = "branch-merge";
const ACTIVE_LEAF_MARKER = "branch-merge:active-leaf";
const MERGE_WATERMARK_FIELD = "branchMergeSourceEntryIds";
const MERGE_SPINNER_WIDGET_KEY = `${EXTENSION_NAME}:summary-spinner`;
const MERGE_WIDGET_PLACEMENT = "aboveEditor";
const MERGE_SPINNER_FRAMES = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
const MERGE_SPINNER_INTERVAL_MS = 250;
const INTERNAL_MERGED_SESSION_REFRESH_COMMAND = "__branch-merge-refresh";
const MERGED_SESSION_REFRESH_DEBOUNCE_MS = 100;
const MERGED_SESSION_REFRESH_RETRY_MS = 250;
const MERGED_SESSION_PENDING_RETRY_MS = 1_000;
const SUMMARY_LABEL_MAX_LENGTH = 60;
const SUMMARY_LABEL_WORD_BOUNDARY_MIN_INDEX = 20;
const SUMMARY_LABEL_MAX_TOKENS = 4096;
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const UUID_FIRST_SEGMENT_RE = /^[0-9a-fA-F]{8}$/;

/** Session-ID argument completion state, kept local to this extension. */
type SessionAutocompleteContext = Pick<
  ExtensionContext,
  "cwd" | "sessionManager"
>;
type SessionAutocompleteCache = {
  sessions?: SessionInfo[];
  updatedAt?: number;
  pending?: Promise<SessionInfo[]>;
};

const CURRENT_PROJECT_SESSION_CACHE_MS = 10_000;
const MAX_SESSION_SUGGESTIONS = 50;

function readCachedSessions(
  cache: SessionAutocompleteCache,
  maxAge: number,
  load: () => Promise<SessionInfo[]>,
): Promise<SessionInfo[]> {
  const refresh = () => {
    cache.pending = load()
      .then((sessions) => {
        cache.sessions = sessions;
        cache.updatedAt = Date.now();
        return sessions;
      })
      .finally(() => {
        cache.pending = undefined;
      });
    return cache.pending;
  };

  if (cache.sessions) {
    if (Date.now() - (cache.updatedAt ?? 0) >= maxAge && !cache.pending) {
      void refresh().catch(() => {});
    }
    return Promise.resolve(cache.sessions);
  }
  return cache.pending ?? refresh();
}

function createSessionArgumentCompletions(
  getContext: () => SessionAutocompleteContext | undefined,
) {
  const currentProjectCaches = new Map<string, SessionAutocompleteCache>();

  return async (prefix: string) => {
    const trimmed = prefix.trim();
    if (/\s/.test(trimmed)) return null;

    const ctx = getContext();
    if (!ctx) return null;

    try {
      const sessionDir = ctx.sessionManager.getSessionDir();
      const cacheKey = `${ctx.cwd}\0${sessionDir}`;
      let currentProjectCache = currentProjectCaches.get(cacheKey);
      if (!currentProjectCache) {
        currentProjectCache = {};
        currentProjectCaches.set(cacheKey, currentProjectCache);
      }
      const current = await readCachedSessions(
        currentProjectCache,
        CURRENT_PROJECT_SESSION_CACHE_MS,
        () => SessionManager.list(ctx.cwd, sessionDir),
      );
      const currentId = ctx.sessionManager.getSessionId();
      const matches = (session: SessionInfo) =>
        session.id !== currentId &&
        session.id.toLowerCase().startsWith(trimmed.toLowerCase());
      const toItem = (session: SessionInfo) => ({
        value: session.id,
        label: session.id.slice(0, 8),
        description: session.name?.trim() || "[Untitled]",
      });
      const sortByModified = (a: SessionInfo, b: SessionInfo) =>
        b.modified.getTime() - a.modified.getTime();
      const items = current
        .filter(matches)
        .sort(sortByModified)
        .slice(0, MAX_SESSION_SUGGESTIONS)
        .map(toItem);
      return items.length > 0 ? items : null;
    } catch {
      return null;
    }
  };
}

const POST_MERGE_BASE_ITEMS: readonly PostMergeItem[] = [
  { value: "switch", label: "Switch to target" },
  { value: "switch-remove", label: "Switch to target and remove source" },
  { value: "stay", label: "Stay in source" },
];

const POST_MERGE_TMUX_ITEMS: readonly PostMergeItem[] = [
  { value: "switch", label: "Switch to target" },
  { value: "switch-remove", label: "Switch to target and remove source" },
  { value: "close-pane", label: "Close this tmux pane" },
  {
    value: "close-pane-remove",
    label: "Close this tmux pane and remove source",
  },
  { value: "stay", label: "Stay in source" },
];

function isInTmux(): boolean {
  return Boolean(process.env.TMUX);
}

function postMergeItems(inTmux: boolean): {
  items: readonly PostMergeItem[];
  defaultIndex: number;
} {
  return inTmux
    ? { items: POST_MERGE_TMUX_ITEMS, defaultIndex: 2 }
    : { items: POST_MERGE_BASE_ITEMS, defaultIndex: 0 };
}

const SUMMARY_LABEL_SYSTEM_PROMPT = `Generate a concise label for a merged session summary.

Rules:
- Return only the label text.
- Think briefly.
- No markdown.
- No quotes.
- No trailing punctuation.
- Prefer 2-8 words.
- Capture what the source session is about for fast session viewer skimming.
- Do not return session IDs, UUIDs, or UUID fragments.`;

type PiModel = NonNullable<ExtensionContext["model"]>;
type GenerateBranchSummaryOptions = Parameters<typeof generateBranchSummary>[1];
type RequestAuth = Awaited<
  ReturnType<ExtensionContext["modelRegistry"]["getApiKeyAndHeaders"]>
>;
type RequestAuthError = Extract<RequestAuth, { error: string }>;
type RequestAuthSuccess = Exclude<RequestAuth, RequestAuthError>;
type CommandSessionManager = ExtensionCommandContext["sessionManager"];
type BranchEntry = ReturnType<CommandSessionManager["getBranch"]>[number];

type BranchSummaryConfig = {
  model?: unknown;
  generateLabelModel?: unknown;
  reserveTokens?: unknown;
};

type Settings = {
  branchSummary?: BranchSummaryConfig;
};

type FileSnapshot = {
  size: number;
  mtimeMs: number;
};

type SummaryModelTarget = {
  model: PiModel;
  auth: RequestAuthSuccess;
};

type MergeSummaryResult = {
  summary: string;
  details: {
    readFiles: string[];
    modifiedFiles: string[];
  };
  sourceEntryIds: string[];
  summaryModel: SummaryModelTarget;
};

type MergeArtifacts = MergeSummaryResult & {
  label: string;
};

type MergeSummaryEvents = {
  onModelStart?(model: PiModel): void;
};

type MergeLabelEvents = {
  onLabelModelStart?(model: PiModel): void;
};

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

function getLogicalLeafId(
  sessionManager: CommandSessionManager,
): string | null {
  const markerLeafId = getMarkerLeafId(sessionManager.getLeafEntry());
  if (markerLeafId !== undefined) return markerLeafId as string;

  const leafId = sessionManager.getLeafId();
  return typeof leafId === "string" ? leafId : null;
}

function isMergeableEntry(entry: BranchEntry) {
  return (
    (entry.type === "message" && entry.message.role !== "toolResult") ||
    entry.type === "custom_message" ||
    entry.type === "branch_summary" ||
    entry.type === "compaction"
  );
}

function hasConversationEntry(entries: BranchEntry[]) {
  return entries.some(isMergeableEntry);
}

function getEntryMergeWatermarks(entry: BranchEntry): string[] | null {
  if (entry.type !== "branch_summary" || !isRecord(entry.details)) return null;

  const value = entry.details[MERGE_WATERMARK_FIELD];
  if (!Array.isArray(value) || !value.every((id) => typeof id === "string"))
    return null;

  return value;
}

function getMergeWatermarks(entries: BranchEntry[]) {
  const watermarks = new Set<string>();

  for (const entry of entries) {
    for (const id of getEntryMergeWatermarks(entry) ?? []) watermarks.add(id);
  }

  return watermarks;
}

function getMergeDelta(
  sourceSessionManager: CommandSessionManager,
  targetSessionManager: CommandSessionManager,
) {
  const sourceLeafId = getLogicalLeafId(sourceSessionManager);
  const targetLeafId = getLogicalLeafId(targetSessionManager);
  const sourceEntries = sourceLeafId
    ? sourceSessionManager.getBranch(sourceLeafId)
    : [];
  const targetEntries = targetLeafId
    ? targetSessionManager.getBranch(targetLeafId)
    : [];
  const knownEntryIds = new Set(targetEntries.map((entry) => entry.id));

  for (const id of getMergeWatermarks(targetEntries)) knownEntryIds.add(id);

  const entries = sourceEntries.filter((entry) => {
    if (!isMergeableEntry(entry) || knownEntryIds.has(entry.id)) return false;

    const watermarks = getEntryMergeWatermarks(entry);
    return !watermarks || !watermarks.every((id) => knownEntryIds.has(id));
  });
  const sourceEntryIds = [
    ...new Set(
      entries.flatMap((entry) => getEntryMergeWatermarks(entry) ?? [entry.id]),
    ),
  ];

  return { entries, sourceEntryIds };
}

function getBranchableLeafId(
  sessionManager: CommandSessionManager,
): string | null {
  const leafId = getLogicalLeafId(sessionManager);
  if (!leafId) return null;
  if (!sessionManager.getEntry(leafId)) return null;
  if (!hasConversationEntry(sessionManager.getBranch(leafId))) return null;
  return leafId;
}

function latestRealUserEntry(
  sessionManager: CommandSessionManager,
): { parentId: string | null; hasPriorConversation: boolean } | null {
  const branch = sessionManager.getBranch();
  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index];
    if (entry.type === "message" && entry.message.role === "user") {
      return {
        parentId: entry.parentId,
        hasPriorConversation: hasConversationEntry(branch.slice(0, index)),
      };
    }
  }

  return null;
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

function assertCommandIdle(ctx: ExtensionContext, command: string) {
  if (!ctx.isIdle()) {
    throw new UserVisibleWarning(
      `Cannot run ${command} while agent is streaming`,
    );
  }
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
      `Failed to read ${globalPath}: ${String(error)}`,
    );
  }

  if (ctx.isProjectTrusted()) {
    try {
      merged = deepMerge(merged, await readJson(projectPath));
    } catch (error) {
      warnOnce(
        ctx,
        `settings:${projectPath}`,
        `Failed to read ${projectPath}: ${String(error)}`,
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
): Promise<SummaryModelTarget | undefined> {
  if (config.model === undefined) return undefined;

  const ref = parseModelRef(config.model);
  if (!ref) {
    warnOnce(
      ctx,
      "model:invalid",
      "Invalid branchSummary.model; falling back to current model",
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
      `Branch summary model ${ref.provider}/${ref.id} not found; falling back to current model`,
    );
    return undefined;
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (isRequestAuthError(auth)) {
    warnOnce(
      ctx,
      `model:auth:${ref.provider}/${ref.id}`,
      `Branch summary model ${ref.provider}/${ref.id} auth failed: ${auth.error}; falling back to current model`,
    );
    return undefined;
  }

  return { model, auth };
}

async function resolveCurrentSummaryModel(
  ctx: ExtensionContext,
): Promise<SummaryModelTarget> {
  const model = ctx.model as PiModel | undefined;
  if (!model) throw new Error("No model available for summarization");

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (isRequestAuthError(auth)) {
    throw new Error(`Current model auth failed: ${auth.error}`);
  }

  return { model, auth };
}

async function resolveConfiguredLabelModel(
  ctx: ExtensionContext,
  config: BranchSummaryConfig,
  fallback: SummaryModelTarget,
): Promise<{ target: SummaryModelTarget; usedConfigured: boolean }> {
  if (config.generateLabelModel === undefined) {
    return { target: fallback, usedConfigured: false };
  }

  const ref = parseModelRef(config.generateLabelModel);
  if (!ref) {
    warnOnce(
      ctx,
      "label-model:invalid",
      "Invalid branchSummary.generateLabelModel; falling back to summary model",
    );
    return { target: fallback, usedConfigured: false };
  }

  const model = ctx.modelRegistry.find(ref.provider, ref.id) as
    | PiModel
    | undefined;
  if (!model) {
    warnOnce(
      ctx,
      `label-model:not-found:${ref.provider}/${ref.id}`,
      `Summary label model ${ref.provider}/${ref.id} not found; falling back to summary model`,
    );
    return { target: fallback, usedConfigured: false };
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (isRequestAuthError(auth)) {
    warnOnce(
      ctx,
      `label-model:auth:${ref.provider}/${ref.id}`,
      `Summary label model ${ref.provider}/${ref.id} auth failed: ${auth.error}; falling back to summary model`,
    );
    return { target: fallback, usedConfigured: false };
  }

  return { target: { model, auth }, usedConfigured: true };
}

function isMissingFileError(error: unknown): boolean {
  return (error as { code?: string }).code === "ENOENT";
}

async function getSnapshot(path: string): Promise<FileSnapshot> {
  const result = await stat(path);
  return { size: result.size, mtimeMs: result.mtimeMs };
}

async function getOptionalSnapshot(
  path: string,
): Promise<FileSnapshot | undefined> {
  try {
    return await getSnapshot(path);
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
}

function sameSnapshot(a: FileSnapshot, b: FileSnapshot): boolean {
  return a.size === b.size && a.mtimeMs === b.mtimeMs;
}

function sameOptionalSnapshot(
  a: FileSnapshot | undefined,
  b: FileSnapshot | undefined,
): boolean {
  if (!a || !b) return a === b;
  return sameSnapshot(a, b);
}

function flushSessionFile(sessionManager: CommandSessionManager): void {
  const rewriteFile = (sessionManager as { _rewriteFile?: () => void })
    ._rewriteFile;
  if (typeof rewriteFile !== "function") {
    throw new Error("Cannot persist current session before reload");
  }
  rewriteFile.call(sessionManager);
}

function parseBranchArgs(
  args: string,
): { split?: "h" | "v"; prompt: string } | { error: string } {
  let rest = args.trim();
  let split: "h" | "v" | undefined;

  const match = rest.match(/^(--vsp|--sp)(?:\s+|$)/);
  if (match) {
    split = match[1] === "--vsp" ? "h" : "v";
    rest = rest.slice(match[0].length).trim();
  }

  if (/^--(?:vsp|sp)\b/.test(rest)) {
    return { error: "Use only one of --vsp or --sp, before the prompt" };
  }

  return split ? { split, prompt: rest } : { prompt: rest };
}

function isSupportedMergeSessionId(value: string) {
  return UUID_RE.test(value) || UUID_FIRST_SEGMENT_RE.test(value);
}

function parseMergeArgs(args: string) {
  const trimmed = args.trim();
  if (!trimmed) return { instruction: "" };

  const [first = "", ...rest] = trimmed.split(/\s+/);
  if (isSupportedMergeSessionId(first)) {
    return { targetSessionId: first, instruction: rest.join(" ") };
  }

  return { instruction: trimmed };
}

async function listCurrentSessions(ctx: ExtensionCommandContext) {
  return SessionManager.list(ctx.cwd, ctx.sessionManager.getSessionDir());
}

async function listAllSessions(ctx: ExtensionCommandContext) {
  const sessionManager = ctx.sessionManager as typeof ctx.sessionManager & {
    usesDefaultSessionDir?: () => boolean;
  };

  return sessionManager.usesDefaultSessionDir?.()
    ? SessionManager.listAll()
    : SessionManager.listAll(ctx.sessionManager.getSessionDir());
}

function matchesSessionId(session: { id: string }, id: string) {
  return UUID_RE.test(id) ? session.id === id : session.id.startsWith(`${id}-`);
}

async function findSessionById(
  sessionId: string,
  ctx: ExtensionCommandContext,
) {
  const currentMatches = (await listCurrentSessions(ctx)).filter((session) =>
    matchesSessionId(session, sessionId),
  );

  if (currentMatches.length === 1) return currentMatches[0]!;
  if (currentMatches.length > 1) {
    throw new Error(`Ambiguous session id in current project: ${sessionId}`);
  }

  const globalMatches = (await listAllSessions(ctx)).filter((session) =>
    matchesSessionId(session, sessionId),
  );

  if (globalMatches.length === 1) return globalMatches[0]!;
  if (globalMatches.length > 1) {
    throw new Error(`Ambiguous session id globally: ${sessionId}`);
  }

  throw new Error(`No session found matching: ${sessionId}`);
}

async function resolveMergeTarget(args: string, ctx: ExtensionCommandContext) {
  const parsed = parseMergeArgs(args);

  if (parsed.targetSessionId) {
    const match = await findSessionById(parsed.targetSessionId, ctx);
    return {
      path: match.path,
      targetSessionId: match.id,
      instruction: parsed.instruction,
    };
  }

  const parentSession = ctx.sessionManager.getHeader()?.parentSession;
  if (!parentSession) {
    throw new Error(
      "No parent session to merge into. Pass a session id or first UUID segment from /session.",
    );
  }

  return {
    path: parentSession,
    targetSessionId: SessionManager.open(parentSession).getSessionId(),
    instruction: parsed.instruction,
  };
}

function sessionIdPrefix(sessionId: string) {
  return sessionId.split("-", 1)[0] ?? sessionId;
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

function normalizeSessionName(name: string | undefined) {
  const trimmed = name?.trim();
  return trimmed ? trimmed : undefined;
}

function truncateLabel(label: string, maxLength = SUMMARY_LABEL_MAX_LENGTH) {
  const chars = Array.from(label);
  if (chars.length <= maxLength) return label;

  const prefix = chars.slice(0, maxLength - 1).join("");
  const lastSpace = prefix.lastIndexOf(" ");
  const shortened =
    lastSpace >= SUMMARY_LABEL_WORD_BOUNDARY_MIN_INDEX
      ? prefix.slice(0, lastSpace)
      : prefix;
  return `${shortened.replace(/[\s\-–—:;,.!?/\\|]+$/u, "")}…`;
}

function cleanLabel(raw: string) {
  const firstLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return undefined;

  const cleaned = firstLine
    .replace(/^[-*#>\s]+/u, "")
    .replace(/^label\s*:\s*/iu, "")
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/gu, "")
    .replace(/[\s.?!,;:]+$/u, "")
    .replace(/\s+/gu, " ")
    .trim();

  return cleaned ? truncateLabel(cleaned) : undefined;
}

function sourceNameLabel(
  sourceSessionName: string | undefined,
  targetSessionName: string | undefined,
) {
  const sourceName = normalizeSessionName(sourceSessionName);
  if (!sourceName) return undefined;

  const targetName = normalizeSessionName(targetSessionName);
  if (targetName && sourceName === targetName) return undefined;
  return cleanLabel(sourceName);
}

async function generateMergeSummary(
  ctx: ExtensionCommandContext,
  instruction: string,
  signal = new AbortController().signal,
  events?: MergeSummaryEvents,
  sourceSessionManager?: CommandSessionManager,
  targetSessionManager?: CommandSessionManager,
): Promise<MergeSummaryResult> {
  const source = sourceSessionManager ?? ctx.sessionManager;
  const target = targetSessionManager ?? ctx.sessionManager;
  const { entries, sourceEntryIds } = getMergeDelta(source, target);
  if (entries.length === 0) {
    throw new UserVisibleWarning("Nothing new to merge");
  }

  const settings = await loadSettings(ctx);
  const config = getBranchSummaryConfig(settings);
  const reserveTokens = parseTokenValue(config.reserveTokens);
  const configured = await resolveConfiguredSummaryModel(ctx, config);

  const run = async (
    target: Awaited<ReturnType<typeof resolveCurrentSummaryModel>>,
  ) => {
    if (signal.aborted) throw new UserVisibleWarning("Merge cancelled");
    events?.onModelStart?.(target.model);
    const options: GenerateBranchSummaryOptions = {
      model: target.model,
      apiKey: target.auth.apiKey ?? "",
      signal,
    };
    if (target.auth.headers) options.headers = target.auth.headers;
    if (instruction) options.customInstructions = instruction;
    if (reserveTokens !== undefined) options.reserveTokens = reserveTokens;

    let result: Awaited<ReturnType<typeof generateBranchSummary>>;
    try {
      result = await generateBranchSummary(entries, options);
    } catch (error) {
      if (signal.aborted) throw new UserVisibleWarning("Merge cancelled");
      throw error;
    }

    if (result.aborted || signal.aborted)
      throw new UserVisibleWarning("Merge cancelled");
    if (result.error) throw new Error(result.error);

    return {
      summary: result.summary ?? "No summary generated",
      details: {
        readFiles: result.readFiles ?? [],
        modifiedFiles: result.modifiedFiles ?? [],
      },
      sourceEntryIds,
      summaryModel: target,
    };
  };

  if (configured) {
    try {
      return await run(configured);
    } catch (error) {
      if (signal.aborted || error instanceof UserVisibleWarning) throw error;
      notify(
        ctx,
        `Branch summary model ${modelName(configured.model)} failed: ${String(error)}; falling back to current model`,
        "warning",
      );
    }
  }

  return run(await resolveCurrentSummaryModel(ctx));
}

function labelPrompt(params: { instruction: string; summary: string }) {
  return [
    params.instruction ? `Merge instruction: ${params.instruction}` : undefined,
    "Merge summary:",
    params.summary,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

async function generateSummaryLabel(
  ctx: ExtensionCommandContext,
  params: {
    sourceSessionId: string;
    sourceSessionName?: string;
    targetSessionName?: string;
    instruction: string;
    summary: string;
    summaryModel: SummaryModelTarget;
  },
  signal: AbortSignal,
  events?: MergeLabelEvents,
) {
  const namedLabel = sourceNameLabel(
    params.sourceSessionName,
    params.targetSessionName,
  );
  if (namedLabel) return namedLabel;

  const fallbackLabel = sessionIdPrefix(params.sourceSessionId);
  if (signal.aborted) throw new UserVisibleWarning("Merge cancelled");

  const settings = await loadSettings(ctx);
  const config = getBranchSummaryConfig(settings);
  const { target, usedConfigured } = await resolveConfiguredLabelModel(
    ctx,
    config,
    params.summaryModel,
  );

  events?.onLabelModelStart?.(target.model);
  try {
    const options: NonNullable<Parameters<typeof completeSimple>[2]> = {
      apiKey: target.auth.apiKey ?? "",
      signal,
      maxTokens: SUMMARY_LABEL_MAX_TOKENS,
      temperature: 0,
    };
    if (target.auth.headers) options.headers = target.auth.headers;

    const response = await completeSimple(
      target.model,
      {
        systemPrompt: SUMMARY_LABEL_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: labelPrompt({
              instruction: params.instruction,
              summary: params.summary,
            }),
            timestamp: Date.now(),
          },
        ],
      },
      options,
    );

    if (response.stopReason === "aborted" || signal.aborted) {
      throw new UserVisibleWarning("Merge cancelled");
    }
    if (response.stopReason === "error") {
      throw new Error(response.errorMessage ?? "label generation failed");
    }

    const rawLabel = response.content
      .filter((content) => content.type === "text")
      .map((content) => content.text)
      .join("\n");
    return cleanLabel(rawLabel) ?? fallbackLabel;
  } catch (error) {
    if (signal.aborted || error instanceof UserVisibleWarning) throw error;
    if (usedConfigured) {
      notify(
        ctx,
        `Summary label model ${modelName(target.model)} failed; using ${fallbackLabel}`,
        "warning",
      );
    }
    return fallbackLabel;
  }
}

function createMergeSpinner(
  tui: TUI,
  renderLine: (frame: string) => string,
): Component & { dispose(): void } {
  let frameIndex = 0;
  const timer = setInterval(() => {
    frameIndex = (frameIndex + 1) % MERGE_SPINNER_FRAMES.length;
    tui.requestRender();
  }, MERGE_SPINNER_INTERVAL_MS);
  (timer as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();

  return {
    render: (width) => {
      const line = renderLine(MERGE_SPINNER_FRAMES[frameIndex]!);
      if (width <= 1) return [truncateToWidth(line, width)];
      return [` ${truncateToWidth(line, width - 2)} `];
    },
    invalidate: () => {},
    dispose: () => clearInterval(timer),
  };
}

async function generateMergeArtifacts(
  ctx: ExtensionCommandContext,
  params: {
    instruction: string;
    targetSessionId: string;
    sourceSessionId: string;
    sourceSessionName?: string;
    targetSessionName?: string;
  },
  signal: AbortSignal,
  events?: MergeSummaryEvents & MergeLabelEvents,
  sourceSessionManager?: CommandSessionManager,
  targetSessionManager?: CommandSessionManager,
): Promise<MergeArtifacts> {
  const generated = await generateMergeSummary(
    ctx,
    params.instruction,
    signal,
    events,
    sourceSessionManager,
    targetSessionManager,
  );
  const label = await generateSummaryLabel(
    ctx,
    {
      sourceSessionId: params.sourceSessionId,
      sourceSessionName: params.sourceSessionName,
      targetSessionName: params.targetSessionName,
      instruction: params.instruction,
      summary: generated.summary,
      summaryModel: generated.summaryModel,
    },
    signal,
    events,
  );

  return { ...generated, label };
}

async function generateMergeArtifactsWithSpinner(
  ctx: ExtensionCommandContext,
  params: {
    instruction: string;
    targetSessionId: string;
    sourceSessionId: string;
    sourceSessionName?: string;
    targetSessionName?: string;
  },
  spinnerText?: {
    summaryPhase: string;
    labelPhase: string;
    sessionPrefix: string;
  },
  sourceSessionManager?: CommandSessionManager,
  targetSessionManager?: CommandSessionManager,
) {
  const controller = new AbortController();
  if (ctx.mode !== "tui") {
    return generateMergeArtifacts(
      ctx,
      params,
      controller.signal,
      undefined,
      sourceSessionManager,
      targetSessionManager,
    );
  }

  const text = spinnerText ?? {
    summaryPhase: " Merge context into ",
    labelPhase: " Generating label for ",
    sessionPrefix: sessionIdPrefix(params.targetSessionId),
  };

  let activeTui: TUI | undefined;
  let baseFocus: unknown;
  let phase: "summary" | "label" = "summary";
  let model = "resolving model";

  const otherUiHasInterrupt = () => {
    const tui = activeTui as unknown as {
      focusedComponent?: unknown;
      hasOverlay?: () => boolean;
    };
    if (tui?.hasOverlay?.()) return true;
    return baseFocus !== undefined && tui?.focusedComponent !== baseFocus;
  };

  const setPhase = (nextPhase: "summary" | "label", nextModel: PiModel) => {
    phase = nextPhase;
    model = modelName(nextModel);
    activeTui?.requestRender();
  };

  const unsubscribe = ctx.ui.onTerminalInput((data) => {
    if (!getKeybindings().matches(data, "app.interrupt")) return;
    if (otherUiHasInterrupt()) return;
    controller.abort();
    return { consume: true };
  });

  ctx.ui.setWidget(
    MERGE_SPINNER_WIDGET_KEY,
    (tui, theme) => {
      activeTui = tui;
      baseFocus ??= (tui as unknown as { focusedComponent?: unknown })
        .focusedComponent;
      return createMergeSpinner(tui, (frame) =>
        [
          theme.fg("accent", frame),
          theme.fg(
            "muted",
            phase === "summary" ? text.summaryPhase : text.labelPhase,
          ),
          theme.fg("accent", text.sessionPrefix),
          theme.fg("dim", " · "),
          theme.fg("warning", model),
          theme.fg("dim", " (<esc> to cancel)"),
        ].join(""),
      );
    },
    { placement: MERGE_WIDGET_PLACEMENT },
  );

  try {
    return await generateMergeArtifacts(
      ctx,
      params,
      controller.signal,
      {
        onModelStart: (nextModel) => setPhase("summary", nextModel),
        onLabelModelStart: (nextModel) => setPhase("label", nextModel),
      },
      sourceSessionManager,
      targetSessionManager,
    );
  } finally {
    unsubscribe();
    ctx.ui.setWidget(MERGE_SPINNER_WIDGET_KEY, undefined, {
      placement: MERGE_WIDGET_PLACEMENT,
    });
  }
}

function postMergeLineWidth(width: number) {
  return Math.max(1, width);
}

function postMergeFit(line: string, width: number) {
  return truncateToWidth(line, postMergeLineWidth(width));
}

function postMergePad(line: string, width: number) {
  const extra = postMergeLineWidth(width) - visibleWidth(line);
  return extra > 0 ? `${line}${" ".repeat(extra)}` : postMergeFit(line, width);
}

function postMergeBorder(theme: Theme, width: number) {
  return theme.fg("accent", "─".repeat(postMergeLineWidth(width)));
}

class PostMergeActionPicker implements Component {
  private selected: number;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly params: {
      targetSessionId: string;
      sourceSessionId: string;
    },
    private readonly items: readonly PostMergeItem[],
    defaultIndex: number,
    private readonly done: (action: PostMergeAction) => void,
  ) {
    this.selected = defaultIndex;
  }

  private selectStay(): void {
    const stay = this.items.find((item) => item.value === "stay");
    this.done(stay ? stay.value : "stay");
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      this.selected =
        (this.selected + this.items.length - 1) % this.items.length;
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.down)) {
      this.selected = (this.selected + 1) % this.items.length;
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.enter)) {
      this.done(this.items[this.selected]!.value);
      return;
    }

    if (matchesKey(data, Key.escape)) {
      this.selectStay();
      return;
    }

    if (data.length === 1 && data >= "1" && data <= String(this.items.length)) {
      this.done(this.items[Number(data) - 1]!.value);
    }
  }

  render(width: number): string[] {
    const lines = [
      postMergeBorder(this.theme, width),
      "",
      this.theme.fg(
        "accent",
        this.theme.bold("Merge complete. Select next action:"),
      ),
      "",
    ];

    for (let index = 0; index < this.items.length; index++) {
      const item = this.items[index]!;
      const text = `${index + 1}) ${item.label}`;
      const prefix =
        index === this.selected ? this.theme.fg("accent", "→") : " ";
      const label =
        index === this.selected ? this.theme.fg("accent", text) : text;
      lines.push(` ${prefix} ${label}`);
    }

    lines.push(
      "",
      this.theme.fg(
        "muted",
        `↑↓ navigate · <cr> select · <esc> stay · 1–${this.items.length} select`,
      ),
      "",
      `${this.theme.fg("muted", "Target")} ${this.theme.fg("warning", sessionIdPrefix(this.params.targetSessionId))} ${this.theme.fg("muted", "← Source")} ${this.theme.fg("success", sessionIdPrefix(this.params.sourceSessionId))}`,
      "",
      postMergeBorder(this.theme, width),
    );

    return lines.map((line) => postMergePad(line, width));
  }

  invalidate(): void {}
}

async function choosePostMergeAction(
  ctx: ExtensionCommandContext,
  params: { targetSessionId: string; sourceSessionId: string },
  inTmux: boolean,
) {
  const { items, defaultIndex } = postMergeItems(inTmux);
  if (ctx.mode !== "tui") return "switch" satisfies PostMergeAction;

  const result = await ctx.ui.custom<PostMergeAction>(
    (tui, theme, _keybindings, done) =>
      new PostMergeActionPicker(tui, theme, params, items, defaultIndex, done),
  );

  return result ?? "stay";
}

async function trashSessionFile(path: string, ctx: ExtensionContext) {
  await new Promise<void>((resolvePromise) => {
    const child = spawn("trash", [path], { stdio: "ignore" });

    child.on("error", (error) => {
      notify(
        ctx,
        `Trash failed; source session kept: ${String(error)}`,
        "warning",
      );
      resolvePromise();
    });

    child.on("exit", (code) => {
      if (code === 0) {
        notify(ctx, "Source session moved to Trash", "info");
      } else {
        notify(
          ctx,
          `Trash exited with code ${code}; source session kept`,
          "warning",
        );
      }
      resolvePromise();
    });
  });
}

function trashDetached(path: string) {
  try {
    const child = spawn("trash", [path], {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Best-effort; the pane is closing regardless.
  }
}

function closeTmuxPane(ctx: ExtensionContext) {
  const child = spawn("tmux", ["kill-pane"], { stdio: "ignore" });
  child.on("error", (error) => {
    notify(ctx, `Failed to close tmux pane: ${String(error)}`, "error");
  });
}

async function branchIntoPane(
  ctx: ExtensionCommandContext,
  orientation: "h" | "v",
  prompt: string,
  whileStreaming = false,
) {
  if (!isInTmux()) {
    notify(ctx, "Not inside tmux; cannot split a pane", "warning");
    return;
  }

  const sourceFile = ctx.sessionManager.getSessionFile();
  if (!sourceFile) {
    notify(ctx, "Cannot branch an in-memory session into a pane", "warning");
    return;
  }

  const sessionDir = ctx.sessionManager.getSessionDir();
  let branchId: string | undefined;
  try {
    if (!whileStreaming) {
      branchId = SessionManager.forkFrom(
        sourceFile,
        ctx.cwd,
        sessionDir,
        {},
      ).getSessionId();
    } else {
      const userEntry = latestRealUserEntry(ctx.sessionManager);
      if (!userEntry) {
        notify(ctx, "Nothing to branch before", "warning");
        return;
      }

      if (userEntry.parentId && userEntry.hasPriorConversation) {
        const branch = SessionManager.open(sourceFile, sessionDir);
        if (!branch.createBranchedSession(userEntry.parentId)) {
          throw new Error("Unable to create branch session");
        }
        branchId = branch.getSessionId();
      } else {
        // Pi does not persist empty sessions. Let child Pi create its own fresh
        // session instead of launching it with an unresolvable session ID.
        branchId = undefined;
      }
    }
  } catch (error) {
    notify(ctx, `Branch failed: ${String(error)}`, "error");
    return;
  }

  const piArgs = ["--session-dir", sessionDir];
  if (branchId) piArgs.push("--session", branchId);
  if (prompt) piArgs.push(prompt);

  const envArgs: string[] = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key === "TMUX" || key === "TMUX_PANE") continue;
    envArgs.push("-e", `${key}=${value}`);
  }

  // Re-exec the same node + Pi entry this process is running, so the new pane
  // matches the current Pi regardless of how it was launched (alias, shim, PATH).
  const piEntry = process.argv[1];
  const command = piEntry
    ? [process.execPath, piEntry, ...piArgs]
    : ["pi", ...piArgs];

  const child = spawn(
    "tmux",
    [
      "split-window",
      orientation === "h" ? "-h" : "-v",
      "-c",
      ctx.cwd,
      ...envArgs,
      ...command,
    ],
    { stdio: "ignore" },
  );
  child.on("error", (error) => {
    notify(ctx, `tmux split failed: ${String(error)}`, "error");
  });
}

function parsePullArgs(args: string) {
  const trimmed = args.trim();
  if (!trimmed)
    return {
      error: "Usage: /pull <source-session-id|first-segment> [instruction]",
    };

  const [first = "", ...rest] = trimmed.split(/\s+/);
  if (!isSupportedMergeSessionId(first)) {
    return {
      error: `Invalid session id: ${first}. Use a full UUID or first segment from /session.`,
    };
  }

  return { sourceSessionId: first, instruction: rest.join(" ") };
}

async function pull(args: string, ctx: ExtensionCommandContext) {
  assertCommandIdle(ctx, "/pull");

  const parsed = parsePullArgs(args);
  if ("error" in parsed) throw new UserVisibleWarning(parsed.error);

  const targetSessionFile = ctx.sessionManager.getSessionFile();
  if (!targetSessionFile)
    throw new Error("Cannot pull into an in-memory session");

  const targetSessionId = ctx.sessionManager.getSessionId();
  if (matchesSessionId({ id: targetSessionId }, parsed.sourceSessionId)) {
    throw new Error("Cannot pull from a session into itself");
  }

  const targetSessionName = ctx.sessionManager.getSessionName();
  const sourceMatch = await findSessionById(parsed.sourceSessionId, ctx);
  const sourcePath = resolve(sourceMatch.path);

  if (resolve(targetSessionFile) === sourcePath) {
    throw new Error("Cannot pull from a session into itself");
  }

  let sourceSession: ReturnType<typeof SessionManager.open>;
  try {
    sourceSession = SessionManager.open(sourcePath);
  } catch {
    throw new UserVisibleWarning(
      `Source session not found: ${parsed.sourceSessionId}`,
    );
  }
  const sourceSessionId = sourceSession.getSessionId();
  const sourceSessionName = sourceSession.getSessionName();
  const sourceSessionFile = sourceSession.getSessionFile();
  if (!sourceSessionFile) throw new Error("Source session has no file");

  let sourceBefore: FileSnapshot;
  try {
    sourceBefore = await getSnapshot(sourceSessionFile);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
    throw new UserVisibleWarning(
      `Source session file missing: ${parsed.sourceSessionId}`,
    );
  }
  const targetBefore = await getOptionalSnapshot(targetSessionFile);
  const artifactParams: Parameters<
    typeof generateMergeArtifactsWithSpinner
  >[1] = {
    instruction: parsed.instruction,
    targetSessionId,
    sourceSessionId,
  };
  if (sourceSessionName) artifactParams.sourceSessionName = sourceSessionName;
  if (targetSessionName) artifactParams.targetSessionName = targetSessionName;

  const generated = await generateMergeArtifactsWithSpinner(
    ctx,
    artifactParams,
    {
      summaryPhase: " Pulling context from ",
      labelPhase: " Generating label for ",
      sessionPrefix: sessionIdPrefix(sourceSessionId),
    },
    sourceSession as unknown as CommandSessionManager,
    ctx.sessionManager,
  );
  const sourceAfter = await getOptionalSnapshot(sourceSessionFile);
  if (!sourceAfter || !sameSnapshot(sourceBefore, sourceAfter)) {
    throw new UserVisibleWarning(
      "Source session changed during pull. Re-run /pull.",
    );
  }

  const targetAfter = await getOptionalSnapshot(targetSessionFile);
  if (!ctx.isIdle() || !sameOptionalSnapshot(targetBefore, targetAfter)) {
    throw new UserVisibleWarning(
      "Current session changed during pull. Re-run /pull.",
    );
  }

  const targetLeafId = getLogicalLeafId(ctx.sessionManager);
  const targetSession = ctx.sessionManager as unknown as SessionManager;
  const summaryParams: Parameters<typeof formatSummaryWithMetadata>[0] = {
    summary: generated.summary,
    sourceSessionId,
    sourceSessionFile,
    instruction: parsed.instruction,
  };
  if (sourceSessionName) summaryParams.sourceSessionName = sourceSessionName;

  const summary = formatSummaryWithMetadata(summaryParams);
  const details: Record<string, unknown> = {
    ...generated.details,
    [MERGE_WATERMARK_FIELD]: generated.sourceEntryIds,
    sourceSessionId,
    sourceSessionFile,
  };
  if (sourceSessionName) details.sourceSessionName = sourceSessionName;
  if (parsed.instruction) details.instruction = parsed.instruction;

  const summaryId = targetSession.branchWithSummary(
    targetLeafId,
    summary,
    details,
    true,
  );
  targetSession.appendLabelChange(summaryId, generated.label);
  flushSessionFile(targetSession);

  const result = await ctx.switchSession(targetSessionFile, {
    withSession: async (newCtx) => {
      notify(
        newCtx,
        `Pulled summary from ${sessionIdPrefix(sourceSessionId)}`,
        "info",
      );
    },
  });
  if (result.cancelled) {
    notify(
      ctx,
      `Pulled summary from ${sessionIdPrefix(sourceSessionId)}; refresh cancelled`,
      "warning",
    );
  }
}

async function merge(args: string, ctx: ExtensionCommandContext) {
  assertCommandIdle(ctx, "/merge");

  const sourceSessionFile = ctx.sessionManager.getSessionFile();
  if (!sourceSessionFile) throw new Error("Cannot merge an in-memory session");

  const sourceSessionId = ctx.sessionManager.getSessionId();
  const sourceSessionName = ctx.sessionManager.getSessionName();
  const target = await resolveMergeTarget(args, ctx);
  const targetPath = resolve(target.path);
  const targetSession = SessionManager.open(targetPath);
  const targetSessionName = targetSession.getSessionName();

  if (resolve(sourceSessionFile) === targetPath) {
    throw new Error("Cannot merge a session into itself");
  }

  const sourceBefore = await getSnapshot(sourceSessionFile);
  const targetBefore = await getSnapshot(targetPath);
  const artifactParams: Parameters<
    typeof generateMergeArtifactsWithSpinner
  >[1] = {
    instruction: target.instruction,
    targetSessionId: target.targetSessionId,
    sourceSessionId,
  };
  if (sourceSessionName) artifactParams.sourceSessionName = sourceSessionName;
  if (targetSessionName) artifactParams.targetSessionName = targetSessionName;

  const generated = await generateMergeArtifactsWithSpinner(
    ctx,
    artifactParams,
    undefined,
    ctx.sessionManager,
    targetSession,
  );
  const sourceAfter = await getSnapshot(sourceSessionFile);
  const targetAfter = await getSnapshot(targetPath);

  if (!ctx.isIdle() || !sameSnapshot(sourceBefore, sourceAfter)) {
    throw new UserVisibleWarning(
      "Source session changed during merge. Re-run /merge.",
    );
  }

  if (!sameSnapshot(targetBefore, targetAfter)) {
    throw new Error("Target session changed during merge. Re-run /merge.");
  }

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
    [MERGE_WATERMARK_FIELD]: generated.sourceEntryIds,
    sourceSessionId,
    sourceSessionFile,
  };
  if (sourceSessionName) details.sourceSessionName = sourceSessionName;
  if (target.instruction) details.instruction = target.instruction;

  const summaryId = targetSession.branchWithSummary(
    targetLeafId,
    summary,
    details,
    true,
  );
  targetSession.appendLabelChange(summaryId, generated.label);

  const action = await choosePostMergeAction(
    ctx,
    {
      targetSessionId: target.targetSessionId,
      sourceSessionId,
    },
    isInTmux(),
  );
  if (action === "stay") {
    notify(ctx, "Merged into target session", "info");
    return;
  }

  if (action === "close-pane" || action === "close-pane-remove") {
    if (action === "close-pane-remove") trashDetached(sourceSessionFile);
    closeTmuxPane(ctx);
    return;
  }

  if (action === "switch-remove") {
    const result = await ctx.switchSession(targetPath, {
      withSession: async (newCtx) => {
        void trashSessionFile(sourceSessionFile, newCtx);
      },
    });
    if (result.cancelled) notify(ctx, "Switch cancelled", "warning");
    return;
  }

  const result = await ctx.switchSession(targetPath);
  if (result.cancelled) notify(ctx, "Switch cancelled", "warning");
}

function isExternalMergeSummary(entry: BranchEntry, knownIds: Set<string>) {
  if (entry.type !== "branch_summary" || knownIds.has(entry.id)) return false;
  if (!isRecord(entry.details)) return false;

  return (
    typeof entry.details.sourceSessionId === "string" &&
    Array.isArray(entry.details[MERGE_WATERMARK_FIELD])
  );
}

function currentSessionHasExternalMerge(ctx: ExtensionContext) {
  const sessionFile = ctx.sessionManager.getSessionFile();
  if (!sessionFile) return false;

  const knownIds = new Set(
    ctx.sessionManager.getEntries().map((entry) => entry.id),
  );
  return SessionManager.open(sessionFile)
    .getBranch()
    .some((entry) => isExternalMergeSummary(entry, knownIds));
}

function watchForExternalMerge(
  ctx: ExtensionContext,
  requestRefresh: () => Promise<boolean>,
) {
  const sessionFile = ctx.sessionManager.getSessionFile();
  if (ctx.mode !== "tui" || !sessionFile)
    return { stop: () => {}, onAgentSettled: () => {} };

  let closed = false;
  let refreshRequested = false;
  let diskDirty = true;
  let mergePending = false;
  let diskRetryDelay = MERGED_SESSION_REFRESH_RETRY_MS;
  let diskTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;

  const agentCanYield = () => ctx.isIdle() && !ctx.hasPendingMessages();

  const scheduleDiskCheck = (delay: number) => {
    if (closed || refreshRequested || mergePending || !diskDirty) return;
    if (diskTimer) clearTimeout(diskTimer);
    diskTimer = setTimeout(checkDisk, delay);
    diskTimer.unref?.();
  };

  const schedulePendingCheck = () => {
    if (closed || refreshRequested || !mergePending || pendingTimer) return;
    pendingTimer = setTimeout(() => {
      pendingTimer = undefined;
      checkPending();
    }, MERGED_SESSION_PENDING_RETRY_MS);
    pendingTimer.unref?.();
  };

  const checkPending = () => {
    if (closed || refreshRequested || !mergePending) return;
    if (!agentCanYield() || ctx.ui.getEditorText().length > 0) {
      schedulePendingCheck();
      return;
    }

    refreshRequested = true;
    void requestRefresh()
      .then((submitted) => {
        if (closed || submitted) return;
        refreshRequested = false;
        schedulePendingCheck();
      })
      .catch(() => {
        if (closed) return;
        refreshRequested = false;
        schedulePendingCheck();
      });
  };

  const checkDisk = () => {
    diskTimer = undefined;
    if (closed || refreshRequested || mergePending || !diskDirty) return;

    // Target writes while streaming are frequent. Defer all disk parsing until
    // the agent settles; `agent_settled` invokes this check immediately.
    if (!agentCanYield()) return;

    try {
      if (!currentSessionHasExternalMerge(ctx)) {
        diskDirty = false;
        diskRetryDelay = MERGED_SESSION_REFRESH_RETRY_MS;
        return;
      }
    } catch {
      scheduleDiskCheck(diskRetryDelay);
      diskRetryDelay = Math.min(diskRetryDelay * 2, 5_000);
      return;
    }

    diskDirty = false;
    mergePending = true;
    checkPending();
  };

  const sessionDirectory = dirname(sessionFile);
  const sessionFilename = basename(sessionFile);
  let watcher: ReturnType<typeof watch>;
  try {
    // Fresh sessions receive a planned path before their first assistant entry
    // creates the file. Watch its existing directory so that first write, plus
    // atomic replacements, cannot leave this runtime without a watcher.
    watcher = watch(sessionDirectory, { persistent: false }, (_event, name) => {
      if (name && name.toString() !== sessionFilename) return;
      diskDirty = true;
      scheduleDiskCheck(MERGED_SESSION_REFRESH_DEBOUNCE_MS);
    });
  } catch {
    return { stop: () => {}, onAgentSettled: () => {} };
  }

  watcher.on("error", () => {
    watcher.close();
    closed = true;
    if (diskTimer) clearTimeout(diskTimer);
    if (pendingTimer) clearTimeout(pendingTimer);
  });

  // `/reload` does not replace SessionManager. Scan once for an earlier merge.
  scheduleDiskCheck(MERGED_SESSION_REFRESH_DEBOUNCE_MS);

  return {
    stop: () => {
      closed = true;
      watcher.close();
      if (diskTimer) clearTimeout(diskTimer);
      if (pendingTimer) clearTimeout(pendingTimer);
    },
    onAgentSettled: () => {
      if (closed || refreshRequested) return;
      if (mergePending) {
        if (pendingTimer) clearTimeout(pendingTimer);
        pendingTimer = undefined;
        checkPending();
      } else {
        scheduleDiskCheck(0);
      }
    },
  };
}

export default function (pi: ExtensionAPI) {
  let autocompleteContext: SessionAutocompleteContext | undefined;
  let sessionGeneration = 0;
  let externalMergeWatcher = {
    stop: () => {},
    onAgentSettled: () => {},
  };
  const sessionArgumentCompletions = createSessionArgumentCompletions(
    () => autocompleteContext,
  );

  pi.on("session_start", (_event, ctx) => {
    const generation = ++sessionGeneration;
    autocompleteContext = {
      cwd: ctx.cwd,
      sessionManager: ctx.sessionManager,
    };
    void sessionArgumentCompletions("");

    externalMergeWatcher.stop();
    externalMergeWatcher = watchForExternalMerge(
      ctx,
      () =>
        new Promise((resolve) => {
          // Pi permits session replacement only from command handlers. Re-check
          // after `/reload` yields input ownership; never overwrite a new draft.
          const submitTimer = setTimeout(() => {
            if (
              generation !== sessionGeneration ||
              !ctx.isIdle() ||
              ctx.hasPendingMessages() ||
              ctx.ui.getEditorText().length > 0
            ) {
              resolve(false);
              return;
            }
            ctx.ui.setEditorText(`/${INTERNAL_MERGED_SESSION_REFRESH_COMMAND}`);
            process.stdin.emit("data", Buffer.from("\r"));
            resolve(true);
          }, 0);
          submitTimer.unref?.();
        }),
    );
  });

  pi.on("agent_settled", () => {
    externalMergeWatcher.onAgentSettled();
  });

  pi.on("session_shutdown", () => {
    sessionGeneration++;
    autocompleteContext = undefined;
    externalMergeWatcher.stop();
  });

  pi.on("session_tree", async (event) => {
    if (!event.newLeafId) return;

    pi.appendEntry(ACTIVE_LEAF_MARKER, {
      version: 1,
      leafId: event.newLeafId,
      timestamp: Date.now(),
    });
  });

  pi.registerCommand("branch", {
    description:
      "Clone current branch ([--vsp|--sp] splits a tmux pane); optional prompt",
    getArgumentCompletions: (prefix) => {
      const value = prefix.trim();
      if (/\s/.test(value)) return null;

      const items = [
        {
          value: "--sp",
          label: "--sp",
          description: "Split tmux pane top-to-bottom",
        },
        {
          value: "--vsp",
          label: "--vsp",
          description: "Split tmux pane side-by-side",
        },
      ].filter((item) => item.value.startsWith(value));
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      try {
        const parsed = parseBranchArgs(args);
        if ("error" in parsed) {
          notify(ctx, parsed.error, "warning");
          return;
        }

        const whileStreaming = !ctx.isIdle();
        if (whileStreaming && !parsed.split) {
          notify(
            ctx,
            "Branch while streaming requires --sp or --vsp",
            "warning",
          );
          return;
        }
        if (!whileStreaming) assertCommandIdle(ctx, "/branch");

        if (parsed.split && whileStreaming) {
          await branchIntoPane(ctx, parsed.split, parsed.prompt, true);
          return;
        }

        const leafId = getBranchableLeafId(ctx.sessionManager);
        if (!leafId) {
          notify(ctx, "Nothing to clone yet", "warning");
          return;
        }

        if (parsed.split) {
          await branchIntoPane(ctx, parsed.split, parsed.prompt);
          return;
        }

        const prompt = parsed.prompt;
        const options: Parameters<typeof ctx.fork>[1] = { position: "at" };
        if (prompt) {
          options.withSession = async (newCtx) => {
            void newCtx.sendUserMessage(prompt).catch((error: unknown) => {
              notify(
                newCtx,
                error instanceof Error ? error.message : String(error),
                "error",
              );
            });
          };
        }

        const result = await ctx.fork(leafId, options);

        if (result.cancelled) notify(ctx, "Branch cancelled", "warning");
      } catch (error) {
        notify(
          ctx,
          error instanceof Error ? error.message : String(error),
          error instanceof UserVisibleWarning ? "warning" : "error",
        );
      }
    },
  });

  pi.registerCommand("merge", {
    description: "Summarize current session into parent or target session",
    getArgumentCompletions: sessionArgumentCompletions,
    handler: async (args, ctx) => {
      try {
        await merge(args, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        notify(
          ctx,
          message === "Merge cancelled"
            ? "Merge cancelled; target session unchanged"
            : message,
          error instanceof UserVisibleWarning ? "warning" : "error",
        );
      }
    },
  });

  pi.registerCommand(INTERNAL_MERGED_SESSION_REFRESH_COMMAND, {
    handler: async (_args, ctx) => {
      try {
        assertCommandIdle(ctx, "automatic session refresh");
        const sessionFile = ctx.sessionManager.getSessionFile();
        if (!sessionFile)
          throw new Error("Cannot refresh an in-memory session");

        const result = await ctx.switchSession(sessionFile, {
          withSession: async (newCtx) => {
            notify(newCtx, "Merged summary loaded", "info");
          },
        });
        if (result.cancelled)
          notify(ctx, "Automatic session refresh cancelled", "warning");
      } catch (error) {
        notify(
          ctx,
          error instanceof Error ? error.message : String(error),
          error instanceof UserVisibleWarning ? "warning" : "error",
        );
      }
    },
  });

  pi.registerCommand("pull", {
    description:
      "Pull summary from source session into current session (reverse of /merge)",
    getArgumentCompletions: sessionArgumentCompletions,
    handler: async (args, ctx) => {
      try {
        await pull(args, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        notify(
          ctx,
          message === "Merge cancelled"
            ? "Pull cancelled; current session unchanged"
            : message,
          error instanceof UserVisibleWarning ? "warning" : "error",
        );
      }
    },
  });
}
