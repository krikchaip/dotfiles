/**
 * Branch and merge session workflows.
 *
 * /branch \[prompt?\]
 *   With no prompt, clone the current active branch like /clone. With a prompt,
 *   switch to the clone and submit that prompt as its first message.
 *
 * /merge \[target-session-id?\] \[instruction?\]
 *   Summarize the full active path of the current source session and append a
 *   branch_summary entry to the target session's active leaf. The target must be
 *   a full UUID when passed explicitly; otherwise the parent session is used.
 *
 * Merge writes are atomic after generation: source and target snapshots are
 *   checked before/after summary + label generation, then branch_summary and
 *   label entries are appended sequentially. The label phase uses a larger token
 *   budget because reasoning label models can otherwise spend the whole response
 *   on thinking and trigger the source-session-id fallback.
 */

import {
  DynamicBorder,
  generateBranchSummary,
  SessionManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { completeSimple } from "@earendil-works/pi-ai";
import {
  Container,
  getKeybindings,
  SelectList,
  Text,
  type Component,
  type SelectItem,
  type TUI,
} from "@earendil-works/pi-tui";
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

type PostMergeAction = "switch" | "switch-remove" | "stay";

type PostMergeItem = {
  value: PostMergeAction;
  label: string;
  description: string;
};

const EXTENSION_NAME = "branch-merge";
const ACTIVE_LEAF_MARKER = "branch-merge:active-leaf";
const MERGE_SPINNER_WIDGET_KEY = `${EXTENSION_NAME}:summary-spinner`;
const MERGE_WIDGET_PLACEMENT = "aboveEditor";
const MERGE_SPINNER_FRAMES = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
const MERGE_SPINNER_INTERVAL_MS = 250;
const SUMMARY_LABEL_MAX_LENGTH = 60;
const SUMMARY_LABEL_WORD_BOUNDARY_MIN_INDEX = 20;
const SUMMARY_LABEL_MAX_TOKENS = 4096;
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const POST_MERGE_ITEMS = [
  {
    value: "switch",
    label: "1) Switch to target",
    description: "Jump to the merged session",
  },
  {
    value: "switch-remove",
    label: "2) Switch to target and remove source",
    description: "Jump to target, then move this source session to Trash",
  },
  {
    value: "stay",
    label: "3) Stay in source",
    description: "Keep working here after writing the merge summary",
  },
] as const satisfies readonly PostMergeItem[];

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

function isPostMergeAction(value: unknown): value is PostMergeAction {
  return (
    typeof value === "string" &&
    POST_MERGE_ITEMS.some((item) => item.value === value)
  );
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
    return {
      path: matches[0]!.path,
      targetSessionId: matches[0]!.id,
      instruction: parsed.instruction,
    };
  }

  const parentSession = ctx.sessionManager.getHeader()?.parentSession;
  if (!parentSession) {
    throw new Error(
      "No parent session to merge into. Pass a full session id from /session.",
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
): Promise<MergeSummaryResult> {
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
    render: () => [renderLine(MERGE_SPINNER_FRAMES[frameIndex]!)],
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
): Promise<MergeArtifacts> {
  const generated = await generateMergeSummary(
    ctx,
    params.instruction,
    signal,
    events,
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
) {
  const controller = new AbortController();
  if (ctx.mode !== "tui") {
    return generateMergeArtifacts(ctx, params, controller.signal);
  }

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
            phase === "summary"
              ? " Merge context into "
              : " Generating label for ",
          ),
          theme.fg("accent", sessionIdPrefix(params.targetSessionId)),
          theme.fg("dim", " · "),
          theme.fg("warning", model),
          theme.fg("dim", " (<esc> to cancel)"),
        ].join(""),
      );
    },
    { placement: MERGE_WIDGET_PLACEMENT },
  );

  try {
    return await generateMergeArtifacts(ctx, params, controller.signal, {
      onModelStart: (nextModel) => setPhase("summary", nextModel),
      onLabelModelStart: (nextModel) => setPhase("label", nextModel),
    });
  } finally {
    unsubscribe();
    ctx.ui.setWidget(MERGE_SPINNER_WIDGET_KEY, undefined, {
      placement: MERGE_WIDGET_PLACEMENT,
    });
  }
}

async function choosePostMergeAction(ctx: ExtensionCommandContext) {
  if (ctx.mode !== "tui") return "switch" satisfies PostMergeAction;

  const items: SelectItem[] = POST_MERGE_ITEMS.map((item) => ({ ...item }));

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
      selectList.onSelect = (item) => {
        if (isPostMergeAction(item.value)) done(item.value);
      };
      selectList.onCancel = () => done(null);
      container.addChild(selectList);
      container.addChild(
        new DynamicBorder((s: string) => theme.fg("accent", s)),
      );

      return {
        render: (width: number) => container.render(width),
        invalidate: () => container.invalidate(),
        handleInput: (data: string) => {
          if (data >= "1" && data <= String(POST_MERGE_ITEMS.length)) {
            done(POST_MERGE_ITEMS[Number(data) - 1]!.value);
            return;
          }
          selectList.handleInput(data);
          tui.requestRender();
        },
      };
    },
    { overlay: true },
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

async function merge(args: string, ctx: ExtensionCommandContext) {
  assertCommandIdle(ctx, "/merge");

  const sourceSessionFile = ctx.sessionManager.getSessionFile();
  if (!sourceSessionFile) throw new Error("Cannot merge an in-memory session");

  const sourceSessionId = ctx.sessionManager.getSessionId();
  const sourceSessionName = ctx.sessionManager.getSessionName();
  const target = await resolveMergeTarget(args, ctx);
  const targetPath = resolve(target.path);
  const targetSessionName = SessionManager.open(targetPath).getSessionName();

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

  const summaryId = targetSession.branchWithSummary(
    targetLeafId,
    summary,
    details,
    true,
  );
  targetSession.appendLabelChange(summaryId, generated.label);

  const action = await choosePostMergeAction(ctx);
  if (action === "stay") {
    notify(ctx, "Merged into target session", "info");
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
        assertCommandIdle(ctx, "/branch");

        const leafId = getBranchableLeafId(ctx.sessionManager);
        if (!leafId) {
          notify(ctx, "Nothing to clone yet", "warning");
          return;
        }

        const prompt = args.trim();
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
}
