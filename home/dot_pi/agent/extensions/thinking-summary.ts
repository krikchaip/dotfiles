/**
 * Per-message thinking summaries for Pi.
 *
 * When Pi hides thinking blocks, render one summary for each thinking block.
 * Expanded thinking remains unchanged.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const LABEL = "Thinking:";
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
const PREFIX_PATTERN = /^(?:thinking:\s*)+/i;
const LEADING_ANSI_FRAGMENT_PATTERN = /^(?:\s*;?\d{1,3}(?:;\d{1,3})*m)+\s*/;

type ThemeLike = {
  fg(color: "accent" | "error" | "thinkingText", text: string): string;
  bold(text: string): string;
  italic(text: string): string;
};

type ContentContainer = {
  clear(): void;
  addChild(child: unknown): void;
};

type TuiModule = {
  Markdown: new (
    text: string,
    paddingX?: number,
    paddingY?: number,
    markdownTheme?: unknown,
    options?: { color?: (text: string) => string; italic?: boolean },
  ) => unknown;
  Spacer: new (height: number) => unknown;
  Text: new (text: string, paddingX?: number, paddingY?: number) => unknown;
};

type AssistantMessageComponentInstance = {
  contentContainer: ContentContainer;
  hasToolCalls: boolean;
  hideThinkingBlock: boolean;
  hiddenThinkingLabel: string;
  lastMessage?: AssistantMessage;
  markdownTheme: unknown;
  outputPad: number;
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
  const tuiUrl = pathToFileURL(
    join(distDir, "../node_modules/@earendil-works/pi-tui/dist/index.js"),
  ).href;

  const [componentModule, themeModule, tuiModule] = await Promise.all([
    import(componentUrl) as Promise<AssistantMessageModule>,
    import(themeUrl) as Promise<ThemeModule>,
    import(tuiUrl) as Promise<TuiModule>,
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
    if (!this.hideThinkingBlock) {
      return originalUpdateContent.call(this, message);
    }

    // Preserve cache invalidation and other side effects from earlier patches.
    originalUpdateContent.call(this, message);

    this.lastMessage = message;
    this.contentContainer.clear();

    const hasVisibleContent = message.content.some(
      (content) =>
        (content.type === "text" && content.text.trim()) ||
        (content.type === "thinking" && content.thinking.trim()),
    );
    if (hasVisibleContent) {
      this.contentContainer.addChild(new tuiModule.Spacer(1));
    }

    for (let i = 0; i < message.content.length; i++) {
      const content = message.content[i];
      if (content.type === "text" && content.text.trim()) {
        this.contentContainer.addChild(
          new tuiModule.Markdown(
            content.text.trim(),
            this.outputPad,
            0,
            this.markdownTheme,
          ),
        );
        continue;
      }

      if (content.type !== "thinking" || !content.thinking.trim()) continue;

      const hasVisibleContentAfter = message.content
        .slice(i + 1)
        .some(
          (next) =>
            (next.type === "text" && next.text.trim()) ||
            (next.type === "thinking" && next.thinking.trim()),
        );
      const summary = getThinkingSummary(content.thinking);
      const label = summary
        ? formatThinkingSummary(themeModule.theme, summary)
        : this.hiddenThinkingLabel;
      this.contentContainer.addChild(
        new tuiModule.Text(
          themeModule.theme.italic(themeModule.theme.fg("thinkingText", label)),
          this.outputPad,
          0,
        ),
      );
      if (hasVisibleContentAfter) {
        this.contentContainer.addChild(new tuiModule.Spacer(1));
      }
    }

    const hasToolCalls = message.content.some(
      (content) => content.type === "toolCall",
    );
    this.hasToolCalls = hasToolCalls;
    if (message.stopReason === "length") {
      this.contentContainer.addChild(new tuiModule.Spacer(1));
      this.contentContainer.addChild(
        new tuiModule.Text(
          themeModule.theme.fg(
            "error",
            "Error: Model stopped because it reached the maximum output token limit. The response may be incomplete.",
          ),
          this.outputPad,
          0,
        ),
      );
    } else if (!hasToolCalls && message.stopReason === "aborted") {
      const abortMessage =
        message.errorMessage && message.errorMessage !== "Request was aborted"
          ? message.errorMessage
          : "Operation aborted";
      this.contentContainer.addChild(new tuiModule.Spacer(1));
      this.contentContainer.addChild(
        new tuiModule.Text(
          themeModule.theme.fg("error", abortMessage),
          this.outputPad,
          0,
        ),
      );
    } else if (!hasToolCalls && message.stopReason === "error") {
      this.contentContainer.addChild(new tuiModule.Spacer(1));
      this.contentContainer.addChild(
        new tuiModule.Text(
          themeModule.theme.fg(
            "error",
            `Error: ${message.errorMessage || "Unknown error"}`,
          ),
          this.outputPad,
          0,
        ),
      );
    }
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
