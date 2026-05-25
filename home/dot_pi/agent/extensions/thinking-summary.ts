/**
 * Per-message thinking summaries for Pi.
 *
 * When Pi hides thinking blocks, temporarily replace the built-in hidden label
 * with a summary from the current message. Expanded thinking remains unchanged.
 */

import type { AssistantMessage, ThinkingContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const LABEL = "Thinking:";
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
const PREFIX_PATTERN = /^(?:thinking:\s*)+/i;
const LEADING_ANSI_FRAGMENT_PATTERN = /^(?:\s*;?\d{1,3}(?:;\d{1,3})*m)+\s*/;

type ThemeLike = {
  fg(color: "accent" | "thinkingText", text: string): string;
  bold(text: string): string;
  italic(text: string): string;
};

type AssistantMessageComponentInstance = {
  hideThinkingBlock: boolean;
  hiddenThinkingLabel: string;
  updateContent(message: AssistantMessage): void;
};

type AssistantMessageComponentConstructor = {
  prototype?: AssistantMessageComponentInstance;
};

type AssistantMessageModule = {
  AssistantMessageComponent?: AssistantMessageComponentConstructor;
};

type ThemeModule = {
  theme: ThemeLike;
};

let patched = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isThinkingBlock(value: unknown): value is ThinkingContent {
  return (
    isRecord(value) &&
    value.type === "thinking" &&
    typeof value.thinking === "string"
  );
}

function stripPresentation(text: string): string {
  let current = text.replace(ANSI_PATTERN, "");
  let removedLabel = false;

  // Other extensions may have prefixed rendered thinking text. Remove only
  // presentation prefixes before extracting our own summary.
  while (true) {
    const withoutLabel = current.replace(PREFIX_PATTERN, "").trimStart();
    if (withoutLabel !== current) {
      current = withoutLabel;
      removedLabel = true;
      continue;
    }

    const withoutFragments = current
      .replace(LEADING_ANSI_FRAGMENT_PATTERN, "")
      .trimStart();
    const fragmentsExposeLabel =
      withoutFragments.replace(PREFIX_PATTERN, "").trimStart() !==
      withoutFragments;

    if (
      withoutFragments !== current &&
      (removedLabel || fragmentsExposeLabel)
    ) {
      current = withoutFragments;
      continue;
    }

    return current;
  }
}

function getThinkingSummary(rawText: string): string {
  const text = stripPresentation(rawText).trim();
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return (firstLine ?? text)
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\*\*(.*)\*\*$/, "$1")
    .trim();
}

function formatThinkingSummary(theme: ThemeLike, summary: string): string {
  const label = theme.fg("accent", theme.bold(theme.italic(LABEL)));
  const body = theme.fg("thinkingText", theme.italic(summary));

  return `${label} ${body}`;
}

function getMessageThinkingSummary(
  content: AssistantMessage["content"],
): string | undefined {
  for (const block of content) {
    if (!isThinkingBlock(block)) continue;

    const summary = getThinkingSummary(block.thinking);
    if (summary) return summary;
  }

  return undefined;
}

function getPiDistDir(): string {
  const argPath = process.argv[1];
  if (!argPath) throw new Error("Cannot locate Pi entrypoint");

  const entryDir = dirname(realpathSync(argPath));
  const directComponent = join(
    entryDir,
    "modes/interactive/components/assistant-message.js",
  );
  if (existsSync(directComponent)) return entryDir;

  const nestedDist = join(entryDir, "dist");
  const nestedComponent = join(
    nestedDist,
    "modes/interactive/components/assistant-message.js",
  );
  if (existsSync(nestedComponent)) return nestedDist;

  throw new Error(`Cannot locate Pi dist directory from ${argPath}`);
}

async function patchAssistantMessageComponent(): Promise<void> {
  if (patched) return;

  const distDir = getPiDistDir();
  const componentUrl = pathToFileURL(
    join(distDir, "modes/interactive/components/assistant-message.js"),
  ).href;
  const themeUrl = pathToFileURL(
    join(distDir, "modes/interactive/theme/theme.js"),
  ).href;

  const [componentModule, themeModule] = await Promise.all([
    import(componentUrl) as Promise<AssistantMessageModule>,
    import(themeUrl) as Promise<ThemeModule>,
  ]);

  const proto = componentModule.AssistantMessageComponent?.prototype;
  if (!proto?.updateContent) {
    throw new Error("AssistantMessageComponent.updateContent not found");
  }

  const originalUpdateContent = proto.updateContent;

  proto.updateContent = function patchedUpdateContent(
    this: AssistantMessageComponentInstance,
    message: AssistantMessage,
  ): void {
    if (this.hideThinkingBlock) {
      const summary = getMessageThinkingSummary(message.content);
      if (summary) {
        const previousLabel = this.hiddenThinkingLabel;
        this.hiddenThinkingLabel = formatThinkingSummary(
          themeModule.theme,
          summary,
        );

        try {
          return originalUpdateContent.call(this, message);
        } finally {
          this.hiddenThinkingLabel = previousLabel;
        }
      }
    }

    return originalUpdateContent.call(this, message);
  };

  patched = true;
}

export default async function thinkingSummaryExtension(
  pi: ExtensionAPI,
): Promise<void> {
  let patchError: string | undefined;

  try {
    await patchAssistantMessageComponent();
  } catch (error) {
    patchError = error instanceof Error ? error.message : String(error);
  }

  pi.on("session_start", async (_event, ctx) => {
    if (patchError) {
      ctx.ui.notify(`Thinking summary failed: ${patchError}`, "warning");
    }
  });
}
