/**
 * Per-message thinking summaries for Pi.
 *
 * When Pi hides thinking blocks, render one summary for each thinking block.
 * Expanded thinking remains unchanged.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  AssistantMessageComponent,
  type ExtensionAPI,
  type MarkdownTransformer,
} from "@earendil-works/pi-coding-agent";
import {
  Markdown,
  type MarkdownTheme,
  Spacer,
  Text,
} from "@earendil-works/pi-tui";

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

type AssistantMessageComponentInstance = {
  contentContainer: ContentContainer;
  hasToolCalls: boolean;
  hideThinkingBlock: boolean;
  hiddenThinkingLabel: string;
  isStreaming: boolean;
  lastMessage?: AssistantMessage;
  markdownTheme: MarkdownTheme;
  markdownTransformers: readonly MarkdownTransformer[];
  outputPad: number;
  updateContent(message: AssistantMessage, isStreaming?: boolean): void;
};

const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
const theme = new Proxy({} as ThemeLike, {
  get(_target, property) {
    const current = (globalThis as Record<symbol, ThemeLike>)[THEME_KEY];
    if (!current) throw new Error("Pi theme unavailable");
    return current[property as keyof ThemeLike];
  },
});

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

function createMarkdownTransform(
  messageType: "assistant" | "assistant-thinking",
  isStreaming: boolean,
  transformers: readonly MarkdownTransformer[],
) {
  return (markdown: string, availableWidth: number) => {
    let transformed = markdown;
    for (const transformer of transformers) {
      try {
        const next = transformer(transformed, {
          messageType,
          isStreaming,
          availableWidth,
        });
        if (typeof next === "string") transformed = next;
      } catch {
        // Preserve Pi's behavior: one bad transformer does not stop rendering.
      }
    }
    return transformed;
  };
}

function patchAssistantMessageComponent(): void {
  if (patched) return;

  const proto = AssistantMessageComponent.prototype as unknown as
    AssistantMessageComponentInstance | undefined;
  if (!proto?.updateContent) {
    throw new Error("AssistantMessageComponent.updateContent not found");
  }

  const originalUpdateContent = proto.updateContent;

  proto.updateContent = function patchedUpdateContent(
    this: AssistantMessageComponentInstance,
    message: AssistantMessage,
    isStreaming = this.isStreaming,
  ): void {
    if (!this.hideThinkingBlock) {
      return originalUpdateContent.call(this, message, isStreaming);
    }

    // Preserve streaming state, cache invalidation, and side effects from
    // earlier patches before replacing only the hidden-thinking layout.
    originalUpdateContent.call(this, message, isStreaming);

    this.lastMessage = message;
    this.contentContainer.clear();

    const hasVisibleContent = message.content.some(
      (content) =>
        (content.type === "text" && content.text.trim()) ||
        (content.type === "thinking" && content.thinking.trim()),
    );
    if (hasVisibleContent) {
      this.contentContainer.addChild(new Spacer(1));
    }

    for (let i = 0; i < message.content.length; i++) {
      const content = message.content[i];
      if (content.type === "text" && content.text.trim()) {
        this.contentContainer.addChild(
          new Markdown(
            content.text.trim(),
            this.outputPad,
            0,
            this.markdownTheme,
            undefined,
            {
              transform: createMarkdownTransform(
                "assistant",
                this.isStreaming,
                this.markdownTransformers,
              ),
            },
          ),
        );
        continue;
      }

      if (content.type !== "thinking" || !content.thinking.trim()) continue;

      const previousVisibleContent = message.content
        .slice(0, i)
        .findLast(
          (previous) =>
            (previous.type === "text" && previous.text.trim()) ||
            (previous.type === "thinking" && previous.thinking.trim()),
        );
      if (previousVisibleContent?.type === "text") {
        this.contentContainer.addChild(new Spacer(1));
      }

      const hasVisibleContentAfter = message.content
        .slice(i + 1)
        .some(
          (next) =>
            (next.type === "text" && next.text.trim()) ||
            (next.type === "thinking" && next.thinking.trim()),
        );
      const summary = getThinkingSummary(content.thinking);
      const label = summary
        ? formatThinkingSummary(theme, summary)
        : this.hiddenThinkingLabel;
      this.contentContainer.addChild(
        new Text(
          theme.italic(theme.fg("thinkingText", label)),
          this.outputPad,
          0,
        ),
      );
      if (hasVisibleContentAfter) {
        this.contentContainer.addChild(new Spacer(1));
      }
    }

    const hasToolCalls = message.content.some(
      (content) => content.type === "toolCall",
    );
    this.hasToolCalls = hasToolCalls;
    if (message.stopReason === "length") {
      this.contentContainer.addChild(new Spacer(1));
      this.contentContainer.addChild(
        new Text(
          theme.fg("error", "Response was truncated before completion."),
          this.outputPad,
          0,
        ),
      );
    } else if (!hasToolCalls && message.stopReason === "aborted") {
      const abortMessage =
        message.errorMessage && message.errorMessage !== "Request was aborted"
          ? message.errorMessage
          : "Operation aborted";
      this.contentContainer.addChild(new Spacer(1));
      this.contentContainer.addChild(
        new Text(theme.fg("error", abortMessage), this.outputPad, 0),
      );
    } else if (!hasToolCalls && message.stopReason === "error") {
      this.contentContainer.addChild(new Spacer(1));
      this.contentContainer.addChild(
        new Text(
          theme.fg(
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

export default function thinkingSummaryExtension(pi: ExtensionAPI): void {
  let patchError: string | undefined;

  try {
    patchAssistantMessageComponent();
  } catch (error) {
    patchError = error instanceof Error ? error.message : String(error);
  }

  pi.on("session_start", async (_event, ctx) => {
    if (patchError) {
      ctx.ui.notify(`Thinking summary failed: ${patchError}`, "warning");
    }
  });
}
