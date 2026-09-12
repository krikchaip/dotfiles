import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { expect, test } from "vitest";

import { fadeOut, fadeOutLineEnding } from "../../renderer/fade-out.ts";

const truecolorTheme = {
  getBgAnsi: () => "\u001b[48;2;20;30;40m",
  getColorMode: () => "truecolor",
  getFgAnsi: () => "\u001b[38;2;100;150;200m",
} as never;

const fallbackTheme = {
  getBgAnsi: () => "\u001b[49m",
  getColorMode: () => "truecolor",
  getFgAnsi: (color: string) =>
    ({
      customMessageText: "\u001b[39m",
      dim: "\u001b[2m",
      muted: "\u001b[90m",
    })[color] ?? "\u001b[39m",
} as never;

function truecolorForegrounds(text: string): readonly string[] {
  return text
    .split("\u001b[38;2;")
    .slice(1)
    .map((suffix) => `\u001b[38;2;${suffix.slice(0, suffix.indexOf("m") + 1)}`);
}

test("fades the last 12 visible cells and ellipsis toward the message background", () => {
  const line = `\u001b[38;2;100;150;200m${"A".repeat(20)}…\u001b[39m`;
  const faded = fadeOutLineEnding(line, truecolorTheme, "customMessageText");

  expect(stripTerminalSequences(faded)).toBe(`${"A".repeat(20)}…`);
  expect(faded).toContain("\u001b[38;2;38;56;75m…");
  expect(
    truecolorForegrounds(faded).filter(
      (color) => color !== "\u001b[38;2;100;150;200m",
    ),
  ).toHaveLength(13);
});

test("fades smoothly from an active Markdown foreground", () => {
  const line =
    "\u001b[38;2;138;190;183mchromatic-fade-token\u001b[38;2;100;150;200m…";
  const faded = fadeOutLineEnding(line, truecolorTheme, "customMessageText");

  expect(stripTerminalSequences(faded)).toBe("chromatic-fade-token…");
  expect(faded).toContain("\u001b[38;2;138;190;183mchromati");
  expect(faded).toContain("\u001b[38;2;131;180;174mc");
  expect(faded).toContain("\u001b[38;2;38;56;75m…");
});

test("tracks foreground transitions and resets inside the fade", () => {
  const line = [
    "\u001b[38;2;255;0;0mRrr",
    "\u001b[39mDdd",
    "\u001b[38;2;0;255;0mGgg",
    "\u001b[0mFff…",
  ].join("");
  const faded = fadeOutLineEnding(line, truecolorTheme, "customMessageText");

  expect(stripTerminalSequences(faded)).toBe("RrrDddGggFff…");
  expect(faded).toContain("\u001b[38;2;241;2;2mR");
  expect(faded).toContain("\u001b[39m\u001b[38;2;81;121;162mD");
  expect(faded).toContain("\u001b[38;2;8;161;17mG");
  expect(faded).toContain("\u001b[0m\u001b[38;2;52;78;104mF");
});

test("keeps wide graphemes whole while measuring the fade in terminal cells", () => {
  const text = `prefix${"🚀".repeat(6)}…`;
  const faded = fadeOutLineEnding(text, truecolorTheme, "customMessageText");

  expect(stripTerminalSequences(faded)).toBe(text);
  expect(faded).toContain("\u001b[38;2;38;56;75m…");
  expect(faded.split("\u001b[38;2;")).toHaveLength(8);
});

test("uses semantic tones when the foreground or background is terminal-default", () => {
  const faded = fadeOutLineEnding(
    `${"A".repeat(20)}…`,
    fallbackTheme,
    "customMessageText",
  );

  expect(stripTerminalSequences(faded)).toBe(`${"A".repeat(20)}…`);
  expect(faded).toContain("\u001b[90m");
  expect(faded).toContain("\u001b[2m…");
});

test("uses the full semantic fallback for muted transcript text", () => {
  const semanticTheme = {
    getBgAnsi: () => "\u001b[49m",
    getColorMode: () => "truecolor",
    getFgAnsi: (color: string) =>
      ({
        customMessageText: "\u001b[31m",
        dim: "\u001b[33m",
        muted: "\u001b[32m",
      })[color] ?? "\u001b[39m",
  } as never;
  const faded = fadeOutLineEnding(`${"A".repeat(20)}…`, semanticTheme, "muted");

  expect(faded).toContain("\u001b[31m");
  expect(faded).toContain("\u001b[32m");
  expect(faded).toContain("\u001b[33m…");
});

test("includes a wide grapheme that crosses the fade boundary", () => {
  const text = `prefix🚀${"B".repeat(11)}…`;
  const faded = fadeOutLineEnding(text, truecolorTheme, "customMessageText");

  expect(stripTerminalSequences(faded)).toBe(text);
  expect(faded).not.toContain("prefix🚀");
});

test("preserves trailing ANSI style terminators on exact-width text", () => {
  const text = `${"A".repeat(12)}…`;
  const linkClose = "\u001b]8;;\u0007";
  const line = `\u001b[1m\u001b]8;;https://example.com\u0007${text}${linkClose}\u001b[22m`;
  const faded = fadeOutLineEnding(line, truecolorTheme, "customMessageText");

  expect(stripTerminalSequences(faded)).toBe(text);
  expect(faded).toContain(linkClose);
  expect(faded).toContain("\u001b[22m");
});

test("fades the final truncation ellipsis inside structured Markdown", () => {
  const component = {
    invalidate() {},
    render: () => [
      "Natural ending…",
      "│ Truncated table ending… │",
      "└──────────────────────────┘",
    ],
  };
  const [natural, truncated, border] = fadeOut(
    component,
    truecolorTheme,
    "customMessageText",
  ).render(80);

  expect(natural).toBe("Natural ending…");
  expect(truncated).not.toBe("│ Truncated table ending… │");
  expect(stripTerminalSequences(truncated ?? "")).toBe(
    "│ Truncated table ending… │",
  );
  expect(border).toBe("└──────────────────────────┘");
});

test("does not mutate a wrapped component's cached render lines", () => {
  const cachedLines = ["Truncated ending…"];
  const component = {
    invalidate() {},
    render: () => cachedLines,
  };
  const faded = fadeOut(component, truecolorTheme, "customMessageText");
  const first = faded.render(80);
  const second = faded.render(80);

  expect(first).toEqual(second);
  expect(cachedLines).toEqual(["Truncated ending…"]);
});
