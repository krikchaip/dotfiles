import {
  type ExtensionAPI,
  type Theme,
  keyText,
} from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";

/** Identifies parent messages that report sub-agent events. */
export const RESULT_MESSAGE_TYPE = "side-quest-result";

const COLLAPSED_TEXT_CHAR_LIMIT = 240;

type TerminalKind = "completed" | "failed" | "cancelled" | "closed";

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

        if (details?.kind === "parent-request") {
          return SideQuestResultRenderer.renderParentRequest(
            details,
            content,
            options.expanded,
            options.outputPad,
            theme,
          );
        }

        const kind = SideQuestResultRenderer.terminalKind(details, content);
        if (!kind) return new Text(content, options.outputPad, 0);

        return SideQuestResultRenderer.renderTerminal(
          kind,
          details,
          content,
          options.expanded,
          options.outputPad,
          theme,
        );
      },
    );
  }

  /**
   * Renders one status-first terminal event with the approved reference hierarchy.
   */
  private static renderTerminal(
    kind: TerminalKind,
    details: ResultDetails | undefined,
    content: string,
    expanded: boolean,
    outputPad: number,
    theme: Theme,
  ): Box {
    const identity = SideQuestResultRenderer.terminalIdentity(details, content);
    const outcome = SideQuestResultRenderer.terminalOutcome(
      kind,
      details,
      content,
    );
    const pendingQuestion = details?.pendingRequest
      ? (details.question ?? "A parent question remains unanswered and saved.")
      : undefined;
    const tone =
      kind === "completed"
        ? "success"
        : kind === "failed"
          ? "error"
          : "warning";
    const lines = [
      `${theme.fg(tone, theme.bold(`SUBAGENT ${kind.toUpperCase()}`))}  ${theme.fg("accent", identity.type)}`,
      theme.fg("muted", identity.description),
      "",
      SideQuestResultRenderer.expandableText(
        outcome,
        expanded,
        "customMessageText",
        theme,
      ),
      ...(pendingQuestion
        ? [
            "",
            theme.fg("warning", theme.bold("PENDING QUESTION")),
            SideQuestResultRenderer.expandableText(
              pendingQuestion,
              expanded,
              "muted",
              theme,
            ),
          ]
        : []),
      ...(expanded
        ? [
            "",
            theme.fg(
              "muted",
              `session path: ${details?.sessionPath ?? SideQuestResultRenderer.lineValue(content, "Resume:") ?? "Unavailable"}`,
            ),
          ]
        : []),
    ];
    const box = new Box(Math.max(1, outputPad + 1), 1, (text) =>
      theme.bg("customMessageBg", text),
    );

    box.addChild(new Text(lines.join("\n"), 0, 0));

    return box;
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
    const collapsedQuestion = SideQuestResultRenderer.truncateText(question);
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

  /** Renders one collapsed or expanded event text value. */
  private static expandableText(
    text: string,
    expanded: boolean,
    color: "customMessageText" | "muted",
    theme: Theme,
  ): string {
    const collapsed = SideQuestResultRenderer.truncateText(text);
    const truncated = !expanded && collapsed !== text;
    const displayed = expanded ? text : collapsed;
    const suffix = truncated
      ? `${theme.fg("muted", "… ")}${theme.fg("dim", keyText("app.tools.expand"))}${theme.fg("muted", " to expand")}`
      : "";

    return `${theme.fg(color, displayed)}${suffix}`;
  }

  /** Gets a terminal kind from current details or historical message text. */
  private static terminalKind(
    details: ResultDetails | undefined,
    content: string,
  ): TerminalKind | undefined {
    if (
      details?.kind === "completed" ||
      details?.kind === "failed" ||
      details?.kind === "cancelled" ||
      details?.kind === "closed"
    )
      return details.kind;

    const kind = content.match(
      /^Subagent (completed|failed|cancelled|closed):/,
    )?.[1];

    return kind as TerminalKind | undefined;
  }

  /** Gets sub-agent identity from current details or historical message text. */
  private static terminalIdentity(
    details: ResultDetails | undefined,
    content: string,
  ): Readonly<{ type: string; description: string }> {
    const historical = content.match(
      /^Subagent (?:completed|failed|cancelled|closed): ([^\n]*?)(?: — ([^\n]*))?$/m,
    );

    return {
      type: details?.subagentType ?? historical?.[1] ?? "general-purpose",
      description: details?.description ?? historical?.[2] ?? "Side quest",
    };
  }

  /** Gets the result, error, or fallback text for one terminal event. */
  private static terminalOutcome(
    kind: TerminalKind,
    details: ResultDetails | undefined,
    content: string,
  ): string {
    if (details?.response) return details.response;
    if (details?.error) return details.error;

    const result = SideQuestResultRenderer.lineValue(content, "Result:");
    if (result) return result;

    const error = SideQuestResultRenderer.lineValue(content, "Error:");
    if (error) return error;

    if (kind === "completed")
      return "Subagent completed without a final response.";
    if (kind === "cancelled") return "Cancelled by the parent.";
    if (kind === "closed")
      return "Child tmux pane closed before reporting an outcome.";

    return "Subagent failed without a stored error detail.";
  }

  /** Reads a labeled value from historical message text. */
  private static lineValue(content: string, label: string): string | undefined {
    const line = content
      .split("\n")
      .find((candidate) => candidate.startsWith(`${label} `));

    return line?.slice(label.length + 1);
  }

  /** Truncates text by Unicode character before its styled suffix. */
  private static truncateText(text: string): string {
    const characters = Array.from(text);
    if (characters.length <= COLLAPSED_TEXT_CHAR_LIMIT) return text;

    return characters.slice(0, COLLAPSED_TEXT_CHAR_LIMIT).join("").trimEnd();
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
