import { type Theme, initTheme } from "@earendil-works/pi-coding-agent";
import { beforeEach, expect, test } from "vitest";

import { WrapUpRenderer } from "../../renderer/wrap-up-renderer.ts";

const theme = {
  bg: (color: string, text: string) => `<bg:${color}>${text}</bg>`,
  bold: (text: string) => `<bold>${text}</bold>`,
  fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
} as Theme;

beforeEach(() => {
  initTheme("dark", false);
});

function renderResult(result: string, expanded = false): string {
  return WrapUpRenderer.renderResult(
    {
      content: [{ type: "text", text: "Completion recorded." }],
      details: { result },
    },
    { expanded },
    theme,
    { args: { result }, isError: false },
  )
    .render(500)
    .join("\n");
}

test("hides partial subagent_done arguments", () => {
  expect(
    WrapUpRenderer.renderCall({ result: "Partial secret" }, theme, {
      isPartial: true,
    }).render(80),
  ).toEqual([]);
});

test("renders the settled tool result with the FROM PARENT label color", () => {
  const rendered = renderResult("## Result\n\n- Verified in real tmux");

  expect(rendered).toContain(
    "<customMessageLabel><bold>WRAP UP</bold></customMessageLabel>",
  );
  expect(rendered).toContain("<bg:customMessageBg>");
  expect(rendered).toContain("Result");
  expect(rendered).toContain("Verified in real tmux");
  expect(rendered).not.toContain("Completion recorded.");
});

test("uses shared collapsed and expanded transcript Markdown", () => {
  const result = `${"A".repeat(245)} Expanded marker.`;

  const collapsed = renderResult(result);
  expect(collapsed).toContain("to expand");
  expect(collapsed).not.toContain("Expanded marker.");

  const expanded = renderResult(result, true);
  expect(expanded).toContain("Expanded marker.");
  expect(expanded).not.toContain("to expand");
});

test("renders completion errors without hiding their cause", () => {
  const rendered = WrapUpRenderer.renderResult(
    { content: [{ type: "text", text: "Completion rejected." }] },
    { expanded: false },
    theme,
    { args: { result: "Claimed result" }, isError: true },
  )
    .render(120)
    .join("\n");

  expect(rendered).toContain("WRAP UP");
  expect(rendered).toContain("ERROR");
  expect(rendered).toContain("Completion rejected.");
});
