import { type Theme, keyText } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";

const COLLAPSED_QUESTION_CHAR_LIMIT = 240;

type RenderContext = Readonly<{
  args?: unknown;
  expanded?: boolean;
  isError?: boolean;
  isPartial?: boolean;
}>;

/**
 * Owns ask_parent transcript rendering in live and historical sessions.
 */
export class AskParentRenderer {
  private constructor() {}

  /**
   * Renders an in-flight call. Settled calls defer their complete banner to the
   * result renderer so normal and error states each use one continuous box.
   */
  public static renderCall(
    args: unknown,
    theme: Theme,
    context: unknown,
  ): Box | Text {
    const renderContext = context as RenderContext | undefined;
    if (renderContext?.isPartial === false) return new Text("", 0, 0);

    return AskParentRenderer.renderBanner(
      AskParentRenderer.stringArg(args, "prompt"),
      renderContext?.expanded === true,
      undefined,
      theme,
    );
  }

  /**
   * Renders a settled result without exposing provider-facing success text.
   * Error details remain visible in every expansion state.
   */
  public static renderResult(
    result: unknown,
    options: unknown,
    theme: Theme,
    context: unknown,
  ): Box {
    const renderOptions = options as { expanded?: boolean } | undefined;
    const renderContext = context as RenderContext | undefined;
    const error = renderContext?.isError
      ? AskParentRenderer.resultText(result).trim() || "Ask parent failed."
      : undefined;

    return AskParentRenderer.renderBanner(
      AskParentRenderer.stringArg(renderContext?.args, "prompt"),
      renderOptions?.expanded === true,
      error,
      theme,
    );
  }

  /**
   * Renders one approved ask_parent banner with the parent-question truncation
   * and color rules.
   */
  private static renderBanner(
    question: string,
    expanded: boolean,
    error: string | undefined,
    theme: Theme,
  ): Box {
    const collapsedQuestion = AskParentRenderer.truncateQuestion(question);
    const truncated = !expanded && collapsedQuestion !== question;
    const displayedQuestion = expanded ? question : collapsedQuestion;
    const truncationSuffix = truncated
      ? `${theme.fg("muted", "… ")}${theme.fg("dim", keyText("app.tools.expand"))}${theme.fg("muted", " to expand")}`
      : "";
    const heading = error
      ? theme.fg("error", `${theme.bold("ASK PARENT")} · ERROR`)
      : theme.fg("customMessageLabel", theme.bold("ASK PARENT"));
    const lines = [
      heading,
      "",
      `${theme.fg("customMessageText", displayedQuestion)}${truncationSuffix}`,
      ...(error ? ["", theme.fg("error", error)] : []),
    ];
    const box = new Box(2, 1, (text) => theme.bg("customMessageBg", text));

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
   * Extracts text blocks from one settled tool result.
   */
  private static resultText(result: unknown): string {
    if (typeof result !== "object" || result === null) return "";

    const content = (result as { content?: unknown }).content;
    if (!Array.isArray(content)) return "";

    return content
      .filter(
        (block): block is { type: "text"; text: string } =>
          typeof block === "object" &&
          block !== null &&
          (block as { type?: unknown }).type === "text" &&
          typeof (block as { text?: unknown }).text === "string",
      )
      .map((block) => block.text)
      .join("\n");
  }

  /**
   * Reads one non-empty string argument.
   */
  private static stringArg(value: unknown, key: string): string {
    if (typeof value !== "object" || value === null) return "";

    const argument = (value as Record<string, unknown>)[key];

    return typeof argument === "string" ? argument : "";
  }
}
