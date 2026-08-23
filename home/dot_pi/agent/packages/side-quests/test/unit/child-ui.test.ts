import {
  type ExtensionAPI,
  type Theme,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { ChildRuntime } from "../../child/runtime.ts";
import { ChildUI } from "../../child/ui.ts";
import { AskParentRenderer } from "../../renderer/ask-parent-renderer.ts";
import type { ChildManifest, Lifecycle } from "../../store/session.ts";

const NOW = Date.UTC(2025, 0, 2, 3, 4, 5);

const plainTheme = {
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
} as Theme;
const markedTheme = {
  ...plainTheme,
  bg: (color: string, text: string) => `<bg:${color}>${text}</bg>`,
  bold: (text: string) => `<bold>${text}</bold>`,
  fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
} as Theme;

function renderAskParent(options: {
  readonly error?: string;
  readonly expanded?: boolean;
  readonly question: string;
  readonly theme?: Theme;
}): string {
  const result = {
    content: [
      {
        type: "text",
        text:
          options.error ??
          "Your request was sent to the parent agent. Continue the side quest; do not wait for a reply.",
      },
    ],
  };

  return AskParentRenderer.renderResult(
    result,
    { expanded: options.expanded ?? false },
    options.theme ?? plainTheme,
    {
      args: { prompt: options.question },
      isError: options.error !== undefined,
    },
  )
    .render(500)
    .join("\n");
}

function makeRuntime(
  overrides: Partial<ChildManifest> = {},
  options: {
    readonly lifecycle?: Lifecycle;
    readonly replyPending?: boolean;
  } = {},
): ChildRuntime {
  const manifest: ChildManifest = {
    version: 1,
    childId: "child-id",
    parentId: "parent-id",
    ownerId: "owner-id",
    sessionPath: "/tmp/session.jsonl",
    cwd: "/tmp",
    agentName: "general-purpose",
    displayName: "general-purpose",
    description: "an intentionally long task label that must truncate first",
    lifecycle: "interactive",
    inheritContext: true,
    tools: ["read"],
    createdAt: NOW,
    ...overrides,
  };

  return {
    status: () => ({
      manifest,
      lifecycle: options.lifecycle ?? manifest.lifecycle,
      replyPending: options.replyPending ?? true,
    }),
  } as ChildRuntime;
}

function expectExactWidth(lines: readonly string[], width: number): void {
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) expect(visibleWidth(line)).toBe(width);
}

beforeEach(() => {
  initTheme("dark", false);
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

test("child UI registers inherited events and parent continuations", () => {
  const customTypes: string[] = [];
  const pi = {
    on() {},
    registerMessageRenderer(customType: string) {
      customTypes.push(customType);
    },
  } as unknown as ExtensionAPI;

  ChildUI.register(pi, makeRuntime());

  expect(customTypes).toContain("side-quest-result");
  expect(customTypes).toContain("side-quest-continuation");
});

test("child widget stays hidden below its minimum width", () => {
  const runtime = makeRuntime();

  for (const width of [0, 1, 2, 3])
    expect(ChildUI.renderWidget(runtime, width)).toEqual([]);
});

test.each([6, 20, 44, 80, 120])(
  "child widget renders every line at exactly %i terminal cells",
  (width) => {
    expectExactWidth(ChildUI.renderWidget(makeRuntime(), width), width);
  },
);

test("child widget fits its declared four-cell minimum", () => {
  expectExactWidth(ChildUI.renderWidget(makeRuntime(), 4), 4);
});

test("child widget preserves identity and lifecycle at narrow widths", () => {
  const rendered = ChildUI.renderWidget(makeRuntime(), 44);
  const text = rendered.join("\n");

  expect(text).toContain("[general-purpose]");
  expect(text).toContain("interactive · reply pending");
  expectExactWidth(rendered, 44);
});

test("child widget truncates the task before the lifecycle state", () => {
  const rendered = ChildUI.renderWidget(makeRuntime(), 80).join("\n");

  expect(rendered).toContain("…");
  expect(rendered).toContain("interactive · reply pending");
});

test("child widget measures wide Unicode identity and task text by terminal cells", () => {
  const rendered = ChildUI.renderWidget(
    makeRuntime({
      displayName: "代理🤖",
      description: "修正🚀レイアウトの境界を確認するための長いタスク",
    }),
    52,
  );
  const text = rendered.join("\n");

  expect(text).toContain("[代理🤖]");
  expect(text).toContain("interactive · reply pending");
  expect(text).toContain("…");
  expectExactWidth(rendered, 52);
});

test("child widget formats elapsed boundaries deterministically", () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);

  const elapsed = ChildUI.renderWidget(
    makeRuntime({ createdAt: NOW - 3_723_000 }),
    80,
  ).join("\n");
  const future = ChildUI.renderWidget(
    makeRuntime({ createdAt: NOW + 60_000 }),
    80,
  ).join("\n");

  expect(elapsed).toContain("01:02:03");
  expect(future).toContain("00:00:00");
});

test("collapsed ask_parent banners hide success output and truncate after 240 characters", () => {
  const question = "Q".repeat(241);
  const rendered = renderAskParent({ question });

  expect(rendered).toContain("ASK PARENT");
  expect(rendered).toContain(`${"Q".repeat(240)}… `);
  expect(rendered).toContain("to expand");
  expect(rendered).not.toContain("Q".repeat(241));
  expect(rendered).not.toContain("Your request was sent");
  expect(rendered).not.toContain("REPLY PENDING");
});

test("ask_parent uses the approved background and truncation colors", () => {
  const rendered = renderAskParent({
    question: "Q".repeat(241),
    theme: markedTheme,
  });

  expect(rendered).toContain("<bg:customMessageBg>");
  expect(rendered).toContain(
    "<customMessageLabel><bold>ASK PARENT</bold></customMessageLabel>",
  );
  expect(rendered).toContain("<muted>… </muted>");
  expect(rendered).toMatch(/<dim>[^<]*<\/dim><muted> to expand<\/muted>/);
});

test("long ask_parent errors keep their bottom line when collapsed and expanded", () => {
  const question = "Q".repeat(241);
  const error = "A parent question is already pending for this subagent.";
  const collapsed = renderAskParent({ error, question, theme: markedTheme });
  const expanded = renderAskParent({
    error,
    expanded: true,
    question,
    theme: markedTheme,
  });

  expect(collapsed).toContain("<error><bold>ASK PARENT</bold> · ERROR</error>");
  expect(collapsed).toContain(
    `<customMessageText>${"Q".repeat(240)}</customMessageText><muted>… </muted>`,
  );
  expect(collapsed).not.toContain("Q".repeat(241));
  expect(collapsed).toContain(`<error>${error}</error>`);

  expect(expanded).toContain("Q".repeat(241));
  expect(expanded).not.toContain("to expand");
  expect(expanded).toContain(`<error>${error}</error>`);
});

test("settled ask_parent calls defer their complete banner to the result renderer", () => {
  const pending = AskParentRenderer.renderCall(
    { prompt: "Which color should I use?" },
    plainTheme,
    { expanded: false, isPartial: true },
  )
    .render(80)
    .join("\n");
  const settled = AskParentRenderer.renderCall(
    { prompt: "Which color should I use?" },
    plainTheme,
    { expanded: false, isPartial: false },
  )
    .render(80)
    .join("\n");

  expect(pending).toContain("ASK PARENT");
  expect(pending).toContain("Which color should I use?");
  expect(settled).toBe("");
});
