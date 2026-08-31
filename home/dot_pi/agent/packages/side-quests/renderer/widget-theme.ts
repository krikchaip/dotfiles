import type { Theme } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";

export type WidgetState = "starting" | "active" | "waiting" | "stalled";

type Color = (text: string) => string;

export type WidgetPalette = Readonly<{
  frame: Color;
  title: Color;
  elapsed: Color;
  identity: Color;
  marker: Color;
  state: (state: WidgetState, replyPending: boolean, text: string) => string;
  lifecycle: (replyPending: boolean, text: string) => string;
}>;

const identity: Color = (text) => text;

/** Builds the shared semantic color hierarchy for parent and child widgets. */
export function widgetPalette(theme?: Theme): WidgetPalette {
  if (!theme) {
    return {
      frame: identity,
      title: identity,
      elapsed: identity,
      identity,
      marker: identity,
      state: (_state, _replyPending, text) => text,
      lifecycle: (_replyPending, text) => text,
    };
  }

  const accent = (text: string) => theme.fg("accent", text);

  return {
    frame: (text) => theme.fg("muted", text),
    title: (text) => accent(theme.bold(text)),
    elapsed: (text) => theme.fg("dim", text),
    identity: (text) => accent(theme.bold(text)),
    marker: accent,
    state: (state, replyPending, text) => {
      if (replyPending) return theme.fg("warning", text);

      switch (state) {
        case "active":
          return theme.fg("success", text);
        case "stalled":
          return theme.fg("error", text);
        case "starting":
          return accent(text);
        case "waiting":
          return theme.fg("muted", text);
      }
    },
    lifecycle: (replyPending, text) =>
      theme.fg(replyPending ? "warning" : "muted", text),
  };
}

/** Renders a muted frame with an accent identity title at exact width. */
export function widgetTitle(
  label: string,
  innerWidth: number,
  palette: WidgetPalette,
): string {
  if (innerWidth < 4) return palette.frame(`╭${"─".repeat(innerWidth)}╮`);

  const availableWidth = innerWidth - 3;
  const displayed =
    visibleWidth(label) <= availableWidth
      ? label
      : `${sliceByColumn(label, 0, Math.max(0, availableWidth - 1), true)}…`;
  const fill = "─".repeat(
    Math.max(0, innerWidth - visibleWidth(displayed) - 3),
  );

  return `${palette.frame("╭─ ")}${palette.title(displayed)}${palette.frame(` ${fill}╮`)}`;
}

/** Colors only the vertical frame around one already-sized content row. */
export function widgetRow(content: string, palette: WidgetPalette): string {
  return `${palette.frame("│")}${content}${palette.frame("│")}`;
}

/** Renders the shared muted bottom border at exact width. */
export function widgetBottom(
  innerWidth: number,
  palette: WidgetPalette,
): string {
  return palette.frame(`╰${"─".repeat(innerWidth)}╯`);
}
