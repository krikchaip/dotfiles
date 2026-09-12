import { type Theme, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { type Component, Markdown, Text } from "@earendil-works/pi-tui";

import { fadeOut } from "./fade-out.ts";

/** Matches the shared collapsed transcript text limit. */
const COLLAPSED_TEXT_CHAR_LIMIT = 240;

/** Selects the theme color used for one transcript text block. */
export type TranscriptTextColor = "customMessageText" | "muted";

/** Renders shared Unicode-safe collapsed or expanded transcript Markdown. */
export function expandableMarkdown(
  text: string,
  expanded: boolean,
  color: TranscriptTextColor,
  theme: Theme,
): Component {
  const collapsed = truncateTranscriptText(text);
  const truncated = !expanded && collapsed !== text;
  const displayed = expanded ? text : collapsed;
  const markdown = new Markdown(
    `${displayed}${truncated ? "…" : ""}`,
    0,
    0,
    getMarkdownTheme(),
    { color: (content) => theme.fg(color, content) },
  );

  return truncated ? fadeOut(markdown, theme, color) : markdown;
}

/** Renders shared Unicode-safe collapsed or expanded transcript plain text. */
export function expandableText(
  text: string,
  expanded: boolean,
  color: TranscriptTextColor,
  theme: Theme,
): Component {
  const collapsed = truncateTranscriptText(text);
  const truncated = !expanded && collapsed !== text;
  const displayed = `${expanded ? text : collapsed}${truncated ? "…" : ""}`;
  const component = new Text(theme.fg(color, displayed), 0, 0);

  return truncated ? fadeOut(component, theme, color) : component;
}

/** Truncates transcript text by Unicode character before its fade ending. */
export function truncateTranscriptText(text: string): string {
  const characters = Array.from(text);
  if (characters.length <= COLLAPSED_TEXT_CHAR_LIMIT) return text;

  return characters.slice(0, COLLAPSED_TEXT_CHAR_LIMIT).join("").trimEnd();
}
