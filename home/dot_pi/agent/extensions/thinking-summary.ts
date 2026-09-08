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
  type Component,
  Markdown,
  type MarkdownTheme,
  MouseRegion,
  Spacer,
  Text,
  truncateToWidth,
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
  thinkingVisibilityOverrides: Map<number, boolean>;
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

class CollapsedThinkingRunComponent implements Component {
  constructor(
    private readonly summaries: readonly string[],
    private readonly paddingX: number,
  ) {}

  render(width: number): string[] {
    if (width <= 0) return [];

    const paddingX = Math.min(
      this.paddingX,
      Math.max(0, Math.floor((width - 1) / 2)),
    );
    const contentWidth = Math.max(1, width - paddingX * 2);
    const margin = " ".repeat(paddingX);
    const emptyRow = " ".repeat(width);
    const rows: string[] = [];

    for (const summary of this.summaries) {
      if (rows.length > 0) rows.push(emptyRow);
      rows.push(
        `${margin}${truncateToWidth(
          formatThinkingSummary(theme, summary),
          contentWidth,
          "…",
          true,
        )}${margin}`,
      );
    }

    return rows;
  }

  invalidate(): void {}
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

    const finalContentIndex = message.content.length - 1;
    const isRenderableContent = (
      content: AssistantMessage["content"][number],
      index: number,
    ): boolean =>
      (content.type === "text" && Boolean(content.text.trim())) ||
      (content.type === "thinking" &&
        (Boolean(content.thinking.trim()) ||
          (this.isStreaming && index === finalContentIndex)));

    const hasVisibleContent = message.content.some(isRenderableContent);
    if (hasVisibleContent) {
      this.contentContainer.addChild(new Spacer(1));
    }

    let thinkingRunIndex = 0;
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

      if (content.type !== "thinking") continue;

      const runStartIndex = i;
      const thinkingBlocks: string[] = [];
      for (; i < message.content.length; i++) {
        const thinkingContent = message.content[i];
        if (thinkingContent.type !== "thinking") break;
        thinkingBlocks.push(thinkingContent.thinking.trim());
      }
      i--;

      const runIndex = thinkingRunIndex++;
      const summaries = thinkingBlocks
        .map((thinking) => getThinkingSummary(thinking))
        .filter(Boolean);
      const showStreamingPlaceholder =
        summaries.length === 0 &&
        this.isStreaming &&
        i === finalContentIndex;
      if (summaries.length === 0 && !showStreamingPlaceholder) continue;

      const previousVisibleContent = message.content
        .slice(0, runStartIndex)
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
        .some((next, offset) =>
          isRenderableContent(next, i + 1 + offset),
        );
      const hidden =
        this.thinkingVisibilityOverrides.get(runIndex) ??
        this.hideThinkingBlock;
      const fullThinking = thinkingBlocks.filter(Boolean).join("\n\n");
      const thinkingComponent = hidden
        ? new CollapsedThinkingRunComponent(
            summaries.length > 0 ? summaries : ["…"],
            this.outputPad,
          )
        : fullThinking
          ? new Markdown(
              fullThinking,
              this.outputPad,
              0,
              this.markdownTheme,
              {
                color: (text) => theme.fg("thinkingText", text),
                italic: true,
              },
              {
                transform: createMarkdownTransform(
                  "assistant-thinking",
                  this.isStreaming,
                  this.markdownTransformers,
                ),
              },
            )
          : new Text(
              theme.italic(
                theme.fg("thinkingText", this.hiddenThinkingLabel),
              ),
              this.outputPad,
              0,
            );
      this.contentContainer.addChild(
        new MouseRegion(thinkingComponent, (event) => {
          if (event.type !== "click" || event.button !== "left") {
            return undefined;
          }
          this.thinkingVisibilityOverrides.set(runIndex, !hidden);
          if (this.lastMessage) this.updateContent(this.lastMessage);
          return { handled: true };
        }),
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
