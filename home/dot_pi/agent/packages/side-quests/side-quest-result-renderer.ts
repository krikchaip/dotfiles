import {
  type ExtensionAPI,
  type Theme,
  keyHint,
  keyText,
} from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";

/** Identifies parent messages that report sub-agent events. */
export const RESULT_MESSAGE_TYPE = "side-quest-result";

const COLLAPSED_QUESTION_CHAR_LIMIT = 240;

/**
 * Describes optional details shown in an expanded sub-agent event.
 */
export type ResultDetails = Readonly<{
  /** Identifies the sub-agent event. */
  kind?: "parent-request" | "completed" | "failed" | "cancelled" | "closed";

  /** Identifies the sub-agent role that produced the event. */
  subagentType?: string;

  /** Records the sub-agent's current task description. */
  description?: string;

  /** Records a question that the sub-agent sent to its parent. */
  question?: string;

  /** Records the canonical session path for resuming the sub-agent. */
  sessionPath?: string;

  /** Records the final sub-agent response when one exists. */
  response?: string;

  /** Records the terminal failure detail when one exists. */
  error?: string;

  /** Reports whether the sub-agent still has an unanswered parent request. */
  pendingRequest?: boolean;
}>;

/**
 * Owns side-quest event rendering in parent and inherited child transcripts.
 */
export class SideQuestResultRenderer {
  private constructor() {}

  /**
   * Registers collapsed and expanded presentation for sub-agent events.
   */
  public static register(pi: ExtensionAPI): void {
    pi.registerMessageRenderer(
      RESULT_MESSAGE_TYPE,
      (message, options, theme) => {
        const details = message.details as ResultDetails | undefined;
        const content = SideQuestResultRenderer.messageText(message.content);
        const title = content.split("\n", 1)[0];
        const heading = title || "Subagent event";

        if (details?.kind === "parent-request") {
          return SideQuestResultRenderer.renderParentRequest(
            details,
            content,
            options.expanded,
            options.outputPad,
            theme,
          );
        }

        if (!options.expanded) {
          const hint = keyHint("app.tools.expand", "to expand");
          return new Text(
            `${theme.fg("accent", heading)} ${theme.fg("dim", `(${hint})`)}`,
            options.outputPad,
            0,
          );
        }

        const text = [
          theme.fg("accent", heading),
          details?.response ? `Result: ${details.response}` : undefined,
          details?.error ? `Error: ${details.error}` : undefined,
          details?.pendingRequest
            ? "A parent question remains unanswered and saved."
            : undefined,
          details?.sessionPath ? `Resume: ${details.sessionPath}` : undefined,
        ]
          .filter((line): line is string => line !== undefined)
          .join("\n");

        return new Text(text, options.outputPad, 0);
      },
    );
  }

  /**
   * Renders one identity-first sub-agent question banner.
   */
  private static renderParentRequest(
    details: ResultDetails,
    content: string,
    expanded: boolean,
    outputPad: number,
    theme: Theme,
  ): Box {
    const type = details.subagentType ?? "general-purpose";
    const description = details.description ?? "Side quest";
    const question =
      details.question ??
      details.response ??
      content.match(/^Subagent asks:\s*([^\n]*)/)?.[1] ??
      "Subagent has a question.";
    const collapsedQuestion =
      SideQuestResultRenderer.truncateQuestion(question);
    const truncated = !expanded && collapsedQuestion !== question;
    const displayedQuestion = expanded ? question : collapsedQuestion;
    const truncationSuffix = truncated
      ? `${theme.fg("muted", "… ")}${theme.fg("dim", keyText("app.tools.expand"))}${theme.fg("muted", " to expand")}`
      : "";
    const lines = [
      `${theme.fg("customMessageLabel", theme.bold("SUBAGENT ASKS"))}  ${theme.fg("accent", type)}`,
      theme.fg("muted", description),
      "",
      `${theme.fg("customMessageText", displayedQuestion)}${truncationSuffix}`,
      ...(expanded && details.sessionPath
        ? ["", theme.fg("muted", `session path: ${details.sessionPath}`)]
        : []),
    ];
    const box = new Box(Math.max(1, outputPad + 1), 1, (text) =>
      theme.bg("customMessageBg", text),
    );

    box.addChild(new Text(lines.join("\n"), 0, 0));

    return box;
  }

  /**
   * Truncates a collapsed question before its separately styled ellipsis.
   */
  private static truncateQuestion(question: string): string {
    const characters = Array.from(question);
    if (characters.length <= COLLAPSED_QUESTION_CHAR_LIMIT) return question;

    return characters
      .slice(0, COLLAPSED_QUESTION_CHAR_LIMIT)
      .join("")
      .trimEnd();
  }

  /**
   * Converts a message content value to plain text.
   */
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
