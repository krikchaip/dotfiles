import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Spacer, Text } from "@earendil-works/pi-tui";

import { expandableMarkdown } from "./expandable-markdown.ts";

/** Identifies a parent answer or direct continuation in a child transcript. */
export const CONTINUATION_MESSAGE_TYPE = "side-quest-continuation";

type ContinuationDetails = Readonly<{
  /** Identifies the child question that this parent answer resolves. */
  requestId?: unknown;

  /** Identifies one durable parent-response delivery. */
  responseId?: unknown;

  /** Records the original child question for local transcript context. */
  question?: unknown;
}>;

/**
 * Owns parent-answer and direct-continuation rendering in child transcripts.
 */
export class ContinuationRenderer {
  private constructor() {}

  /** Registers the FROM PARENT custom-message renderer. */
  public static register(pi: ExtensionAPI): void {
    let historicalQuestions = new Map<string, string>();

    pi.on("session_start", (_event, context) => {
      historicalQuestions = ContinuationRenderer.historicalQuestions(
        context.sessionManager.getBranch(),
      );
    });

    pi.registerMessageRenderer(
      CONTINUATION_MESSAGE_TYPE,
      (message, options, theme) => {
        const details = message.details as ContinuationDetails | undefined;
        const reply = ContinuationRenderer.messageText(message.content);
        const question = ContinuationRenderer.correlatedQuestion(
          details,
          historicalQuestions,
        );
        const box = new Box(Math.max(1, options.outputPad + 1), 1, (text) =>
          theme.bg("customMessageBg", text),
        );

        box.addChild(
          new Text(
            theme.fg("customMessageLabel", theme.bold("FROM PARENT")),
            0,
            0,
          ),
        );
        if (question) {
          box.addChild(
            expandableMarkdown(question, options.expanded, "muted", theme),
          );
          box.addChild(new Spacer(1));
        } else {
          box.addChild(new Spacer(1));
        }
        box.addChild(
          expandableMarkdown(
            reply,
            options.expanded,
            "customMessageText",
            theme,
          ),
        );

        return box;
      },
    );
  }

  /** Returns an original question only for a correlated parent answer. */
  private static correlatedQuestion(
    details: ContinuationDetails | undefined,
    historicalQuestions: ReadonlyMap<string, string>,
  ): string | undefined {
    if (typeof details?.requestId !== "string") return undefined;
    if (typeof details.question === "string") return details.question;

    return typeof details.responseId === "string"
      ? historicalQuestions.get(details.responseId)
      : undefined;
  }

  /**
   * Recovers original questions for continuation records created before Side
   * Quests persisted question text in custom-message details.
   */
  private static historicalQuestions(
    entries: readonly unknown[],
  ): Map<string, string> {
    const promptsByToolCall = new Map<string, string>();
    const questionsByResponse = new Map<string, string>();
    let pendingQuestion: string | undefined;

    for (const value of entries) {
      const entry = ContinuationRenderer.record(value);
      if (!entry) continue;

      if (entry.type === "message") {
        const message = ContinuationRenderer.record(entry.message);
        if (!message) continue;

        if (message.role === "assistant" && Array.isArray(message.content)) {
          for (const value of message.content) {
            const part = ContinuationRenderer.record(value);
            const args = ContinuationRenderer.record(part?.arguments);
            if (
              part?.type === "toolCall" &&
              part.name === "ask_parent" &&
              typeof part.id === "string" &&
              typeof args?.prompt === "string"
            )
              promptsByToolCall.set(part.id, args.prompt);
          }
        }

        if (
          message.role === "toolResult" &&
          message.toolName === "ask_parent" &&
          message.isError !== true &&
          typeof message.toolCallId === "string"
        )
          pendingQuestion = promptsByToolCall.get(message.toolCallId);

        continue;
      }

      if (
        entry.type !== "custom_message" ||
        entry.customType !== CONTINUATION_MESSAGE_TYPE
      )
        continue;

      const details = ContinuationRenderer.record(entry.details);
      if (typeof details?.requestId !== "string") continue;

      if (pendingQuestion && typeof details.responseId === "string")
        questionsByResponse.set(details.responseId, pendingQuestion);

      pendingQuestion = undefined;
    }

    return questionsByResponse;
  }

  /** Narrows an unknown value to a string-keyed record. */
  private static record(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  }

  /** Converts custom-message content to plain text. */
  private static messageText(
    content: string | Array<{ type: string; text?: string }>,
  ): string {
    if (typeof content === "string") return content;

    return content
      .filter(
        (part): part is { type: string; text: string } =>
          part.type === "text" && typeof part.text === "string",
      )
      .map((part) => part.text)
      .join("\n");
  }
}
