import {
  type ExtensionAPI,
  getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Spacer, Text } from "@earendil-works/pi-tui";

import type { ChildRuntime } from "../child/runtime.ts";

/** Identifies the hidden synthesis request and visible final transcript entry. */
export const WRAP_UP_MESSAGE_TYPE = "side-quest-wrap-up";

/** Records the final synthesized handoff rendered in the child transcript. */
export type WrapUpEntryData = Readonly<{
  /** Contains the final Markdown returned by the wrap-up turn. */
  content: string;
}>;

/** Describes the Pi 0.84.3 transcript transform API. */
export type WrapUpMarkdownTransformer = (
  markdown: string,
  context: Readonly<{
    messageType: "user" | "assistant" | "assistant-thinking";
    isStreaming: boolean;
    availableWidth: number;
  }>,
) => string;

type ExtensionAPIWithMarkdownTransformer = ExtensionAPI & {
  registerMarkdownTransformer?: (
    transformer: WrapUpMarkdownTransformer,
  ) => void;
};

/** Owns final-synthesis rendering in child transcripts. */
export class WrapUpRenderer {
  private constructor() {}

  /** Registers hidden assistant rendering and the final WRAP UP entry. */
  public static register(pi: ExtensionAPI, runtime: ChildRuntime): void {
    const markdownPi = pi as ExtensionAPIWithMarkdownTransformer;
    markdownPi.registerMarkdownTransformer?.call(pi, (markdown, context) =>
      context.messageType === "assistant" &&
      runtime.shouldHideWrapUpResponse(markdown, context.isStreaming)
        ? ""
        : markdown,
    );

    pi.registerEntryRenderer<WrapUpEntryData>(
      WRAP_UP_MESSAGE_TYPE,
      (entry, _options, theme) => {
        const content = WrapUpRenderer.entryContent(entry.data);
        if (!content) return undefined;

        const box = new Box(2, 1, (text) => theme.bg("customMessageBg", text));
        box.addChild(
          new Text(theme.fg("warning", theme.bold("WRAP UP")), 0, 0),
        );
        box.addChild(new Spacer(1));
        box.addChild(
          new Markdown(content, 0, 0, getMarkdownTheme(), {
            color: (text) => theme.fg("customMessageText", text),
          }),
        );

        return box;
      },
    );
  }

  /** Returns persisted wrap-up text from one unknown custom-entry payload. */
  public static entryContent(value: unknown): string | undefined {
    if (typeof value !== "object" || value === null) return undefined;

    const content = (value as { content?: unknown }).content;
    return typeof content === "string" && content.trim()
      ? content.trim()
      : undefined;
  }
}
