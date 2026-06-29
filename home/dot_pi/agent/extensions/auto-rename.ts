/**
 * Semantic session naming for Pi.
 *
 * Automatically names new unnamed sessions after the first assistant reply.
 * Use /rename to regenerate the current session name on demand.
 *
 * Configure in ~/.pi/agent/settings.json:
 * {
 *   "autoRename": {
 *     "enabled": true,
 *     "model": "google/gemini-2.5-flash"
 *   }
 * }
 */

import { complete } from "@earendil-works/pi-ai/compat";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

type PiModel = NonNullable<ExtensionContext["model"]>;

type AutoRenameConfig = {
  enabled?: unknown;
  model?: unknown;
};

type Settings = {
  autoRename?: AutoRenameConfig;
};

type TextBlock = {
  type?: string;
  text?: string;
};

type DialoguePart = {
  role: "user" | "assistant";
  text: string;
};

const EXTENSION_NAME = "auto-rename";
const OUTPUT_TOKENS = 64;
const CONTEXT_RESERVE_TOKENS = 4096;
const DEFAULT_CONTEXT_WINDOW = 32_000;
const ESTIMATED_CHARS_PER_TOKEN = 4;
const SYSTEM_PROMPT = [
  "You generate names for Pi coding agent sessions.",
  "Return exactly one session name and nothing else.",
  "The name must contain 2-8 words and be clear at first glance.",
  "Give more weight to recent exchanges than to older context.",
  "Do not end the name with a full stop.",
].join("\n");

let warnedSettings = false;
const warnedAutoFailures = new Set<string>();

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

async function loadSettings(ctx: ExtensionContext): Promise<Settings> {
  const settingsPath = join(homedir(), ".pi", "agent", "settings.json");

  try {
    const parsed = JSON.parse(await readFile(settingsPath, "utf8"));
    return isRecord(parsed) ? (parsed as Settings) : {};
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return {};
    if (!warnedSettings) {
      warnedSettings = true;
      notify(
        ctx,
        `${EXTENSION_NAME}: failed to read ${settingsPath}: ${String(error)}`,
        "warning",
      );
    }
    return {};
  }
}

function getAutoRenameConfig(settings: Settings): AutoRenameConfig {
  return isRecord(settings.autoRename) ? settings.autoRename : {};
}

function parseModelRef(
  value: unknown,
): { provider: string; id: string } | undefined {
  if (typeof value !== "string") return undefined;

  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return undefined;
  return { provider: value.slice(0, slash), id: value.slice(slash + 1) };
}

function modelName(model: PiModel): string {
  return `${model.provider}/${model.id}`;
}

async function resolveNamingModel(ctx: ExtensionContext): Promise<PiModel> {
  const settings = await loadSettings(ctx);
  const config = getAutoRenameConfig(settings);

  if (config.enabled === false) {
    throw new Error("autoRename.enabled is false");
  }

  if (config.model === undefined || config.model === "") {
    if (!ctx.model) throw new Error("no current model selected");
    return ctx.model;
  }

  const ref = parseModelRef(config.model);
  if (!ref) throw new Error("invalid autoRename.model");

  const model = ctx.modelRegistry.find(ref.provider, ref.id) as
    | PiModel
    | undefined;
  if (!model) throw new Error(`model not found: ${ref.provider}/${ref.id}`);

  return model;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content
    .filter(
      (block): block is TextBlock =>
        isRecord(block) &&
        block.type === "text" &&
        typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function branchDialogueParts(branch: unknown[]): DialoguePart[] {
  const parts: DialoguePart[] = [];

  for (const entry of branch) {
    if (!isRecord(entry) || entry.type !== "message") continue;
    const message = entry.message;
    if (!isRecord(message)) continue;
    if (message.role !== "user" && message.role !== "assistant") continue;

    const text = textFromContent(message.content);
    if (!text) continue;
    parts.push({ role: message.role, text });
  }

  return parts;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / ESTIMATED_CHARS_PER_TOKEN);
}

function conversationBudgetTokens(model: PiModel): number {
  return Math.max(
    1_000,
    (model.contextWindow ?? DEFAULT_CONTEXT_WINDOW) - CONTEXT_RESERVE_TOKENS,
  );
}

function formatPart(part: DialoguePart, newestIndex: number): string {
  return [
    `<exchange index="${newestIndex}" role="${part.role}">`,
    part.text,
    "</exchange>",
  ].join("\n");
}

function buildConversationBlock(parts: DialoguePart[], model: PiModel): string {
  const budget = conversationBudgetTokens(model);
  const selected: string[] = [];
  let used = 0;
  let omitted = 0;

  for (let i = parts.length - 1, newestIndex = 1; i >= 0; i--, newestIndex++) {
    const formatted = formatPart(parts[i], newestIndex);
    const tokens = estimateTokens(formatted);

    if (used + tokens <= budget) {
      selected.push(formatted);
      used += tokens;
      continue;
    }

    const remaining = Math.max(0, budget - used);
    if (remaining > 100 && selected.length === 0) {
      const maxChars = remaining * ESTIMATED_CHARS_PER_TOKEN;
      selected.push(
        formatPart(
          { ...parts[i], text: parts[i].text.slice(-maxChars) },
          newestIndex,
        ),
      );
      used = budget;
    }
    omitted = i + 1;
    break;
  }

  return [
    "Conversation excerpts are newest to oldest. Exchange index 1 is most recent.",
    omitted > 0
      ? `${omitted} older message(s) omitted because the naming model context budget was full.`
      : undefined,
    "",
    selected.join("\n\n"),
  ]
    .filter((part): part is string => typeof part === "string")
    .join("\n");
}

function buildNamingPrompt(parts: DialoguePart[], model: PiModel): string {
  return [
    "Generate a session name for this active session branch.",
    "Naming rules:",
    "- Use 2-8 words.",
    "- Keep the name short and specific.",
    "- Make the name immediately understandable.",
    "- Prioritize the most recent exchange over older exchanges.",
    "- Output only the name.",
    "",
    buildConversationBlock(parts, model),
  ].join("\n");
}

function normalizeName(raw: string): string | undefined {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed || /\.\s*$/.test(collapsed)) return undefined;

  const words = collapsed.split(/\s+/);
  if (words.length < 2 || words.length > 8) return undefined;

  const lowered = collapsed.toLocaleLowerCase();
  const firstLetterIndex = lowered.search(/\p{L}/u);
  if (firstLetterIndex < 0) return undefined;

  return (
    lowered.slice(0, firstLetterIndex) +
    lowered[firstLetterIndex].toLocaleUpperCase() +
    lowered.slice(firstLetterIndex + 1)
  );
}

function responseText(response: Awaited<ReturnType<typeof complete>>): string {
  return response.content
    .filter(
      (content): content is { type: "text"; text: string } =>
        content.type === "text",
    )
    .map((content) => content.text)
    .join("\n")
    .trim();
}

async function generateName(ctx: ExtensionContext): Promise<string> {
  const model = await resolveNamingModel(ctx);
  const parts = branchDialogueParts(ctx.sessionManager.getBranch());
  if (parts.length === 0) throw new Error("no user/assistant messages found");

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error((auth as any).error);

  const response = await complete(
    model,
    {
      systemPrompt: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: buildNamingPrompt(parts, model) }],
          timestamp: Date.now(),
        },
      ],
    },
    {
      apiKey: auth.apiKey ?? "",
      headers: auth.headers,
      maxTokens: OUTPUT_TOKENS,
      signal: ctx.signal,
    },
  );

  const name = normalizeName(responseText(response));
  if (!name)
    throw new Error(`model ${modelName(model)} returned invalid session name`);

  return name;
}

async function renameSession(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
): Promise<string> {
  const name = await generateName(ctx);
  pi.setSessionName(name);
  return name;
}

function hasUserMessage(ctx: ExtensionContext): boolean {
  return ctx.sessionManager
    .getBranch()
    .some(
      (entry: unknown) =>
        isRecord(entry) &&
        entry.type === "message" &&
        isRecord(entry.message) &&
        entry.message.role === "user",
    );
}

function shouldArmAutoRename(
  event: { source: string },
  ctx: ExtensionContext,
  pi: ExtensionAPI,
): boolean {
  return (
    event.source !== "extension" && !pi.getSessionName() && !hasUserMessage(ctx)
  );
}

export default function autoRenameExtension(pi: ExtensionAPI) {
  let autoRenameArmed = false;

  pi.on("input", (event, ctx) => {
    if (shouldArmAutoRename(event, ctx, pi)) autoRenameArmed = true;
    return { action: "continue" };
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (!autoRenameArmed) return;
    if (pi.getSessionName()) {
      autoRenameArmed = false;
      return;
    }

    try {
      await renameSession(ctx, pi);
      autoRenameArmed = false;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const key = `${ctx.model?.provider ?? "none"}/${ctx.model?.id ?? "none"}:${message}`;
      if (!warnedAutoFailures.has(key)) {
        warnedAutoFailures.add(key);
        notify(ctx, `${EXTENSION_NAME}: ${message}`, "warning");
      }
    }
  });

  pi.on("session_start", () => {
    autoRenameArmed = false;
  });

  pi.on("session_shutdown", () => {
    autoRenameArmed = false;
  });

  pi.registerCommand("rename", {
    description: "Generate a semantic session name from the active branch",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await ctx.waitForIdle();
      try {
        const name = await renameSession(ctx, pi);
        notify(ctx, `Session renamed: ${name}`, "info");
      } catch (error) {
        notify(
          ctx,
          `${EXTENSION_NAME}: ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      }
    },
  });
}
