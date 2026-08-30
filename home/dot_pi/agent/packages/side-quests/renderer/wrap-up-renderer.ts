import type { Theme } from "@earendil-works/pi-coding-agent";
import { Box, Spacer, Text } from "@earendil-works/pi-tui";

import { expandableMarkdown } from "./expandable-markdown.ts";

type RenderContext = Readonly<{
  args?: unknown;
  isError?: boolean;
}>;

/** Owns final side-quest handoff rendering in child transcripts. */
export class WrapUpRenderer {
  private constructor() {}

  /** Hides partial completion arguments until the tool result is settled. */
  public static renderCall(
    _args?: unknown,
    _theme?: Theme,
    _context?: unknown,
  ): Text {
    return new Text("", 0, 0);
  }

  /** Renders one settled subagent_done call as the durable WRAP UP banner. */
  public static renderResult(
    result: unknown,
    options: unknown,
    theme: Theme,
    context: unknown,
  ): Box {
    const renderOptions = options as { expanded?: boolean } | undefined;
    const renderContext = context as RenderContext | undefined;
    const content = WrapUpRenderer.stringArg(renderContext?.args, "result");
    const error = renderContext?.isError
      ? WrapUpRenderer.resultText(result).trim() ||
        "Subagent completion failed."
      : undefined;

    return WrapUpRenderer.banner(
      content,
      renderOptions?.expanded === true,
      theme,
      error,
    );
  }

  /** Builds the persisted WRAP UP banner. */
  static banner(
    content: string,
    expanded: boolean,
    theme: Theme,
    error?: string,
  ): Box {
    const box = new Box(2, 1, (text) => theme.bg("customMessageBg", text));
    const heading = error
      ? theme.fg("error", `${theme.bold("WRAP UP")} · ERROR`)
      : theme.fg("customMessageLabel", theme.bold("WRAP UP"));

    box.addChild(new Text(heading, 0, 0));
    if (content) {
      box.addChild(new Spacer(1));
      box.addChild(
        expandableMarkdown(content, expanded, "customMessageText", theme),
      );
    }
    if (error) {
      box.addChild(new Spacer(1));
      box.addChild(new Text(theme.fg("error", error), 0, 0));
    }

    return box;
  }

  /** Reads one string argument. */
  private static stringArg(value: unknown, key: string): string {
    if (typeof value !== "object" || value === null) return "";

    const argument = (value as Record<string, unknown>)[key];
    return typeof argument === "string" ? argument.trim() : "";
  }

  /** Extracts text blocks from one settled tool result. */
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
}
