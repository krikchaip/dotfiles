import {
  type Theme,
  getMarkdownTheme,
  keyText,
} from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";

/** Matches the shared collapsed transcript text limit. */
const COLLAPSED_TEXT_CHAR_LIMIT = 240;

/** Selects the theme color used for one transcript Markdown block. */
type TranscriptTextColor = "customMessageText" | "muted";

/** Renders shared Unicode-safe collapsed or expanded transcript Markdown. */
export function expandableMarkdown(
  text: string,
  expanded: boolean,
  color: TranscriptTextColor,
  theme: Theme,
): Markdown {
  const collapsed = truncateTranscriptText(text);
  const truncated = !expanded && collapsed !== text;
  const displayed = expanded ? text : collapsed;
  const suffix = truncated
    ? `${theme.fg("muted", "… ")}${theme.fg("dim", keyText("app.tools.expand"))}${theme.fg("muted", " to expand")}`
    : "";

  return new Markdown(`${displayed}${suffix}`, 0, 0, getMarkdownTheme(), {
    color: (content) => theme.fg(color, content),
  });
}

/** Truncates transcript text by Unicode character before its styled suffix. */
function truncateTranscriptText(text: string): string {
  const characters = Array.from(text);
  if (characters.length <= COLLAPSED_TEXT_CHAR_LIMIT) return text;

  return characters.slice(0, COLLAPSED_TEXT_CHAR_LIMIT).join("").trimEnd();
}
