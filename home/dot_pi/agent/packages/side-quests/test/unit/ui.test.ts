import {
  type ExtensionAPI,
  type Theme,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { ParentChild, ParentRuntime } from "../../parent/runtime.ts";
import { ParentUI } from "../../parent/ui.ts";

const NOW = Date.UTC(2025, 0, 2, 3, 4, 5);

function makeChild(
  childId: string,
  overrides: Partial<ParentChild["manifest"]> = {},
): ParentChild {
  return {
    manifest: {
      version: 1,
      childId,
      parentId: "parent-id",
      ownerId: "owner-id",
      sessionPath: `/tmp/${childId}/session.jsonl`,
      cwd: "/tmp",
      agentName: "general-purpose",
      displayName: "general-purpose",
      description: "an intentionally long task label that must truncate first",
      lifecycle: "autonomous",
      inheritContext: true,
      tools: ["read"],
      createdAt: NOW,
      ...overrides,
    },
    paneId: `%${childId}`,
    windowId: "@1",
  };
}

function makeRuntime(
  children: readonly ParentChild[],
  options: {
    readonly pending?: ReadonlySet<string>;
    readonly statuses?: Readonly<
      Record<string, "starting" | "active" | "waiting" | "stalled">
    >;
  } = {},
): ParentRuntime {
  return {
    children: () => children,
    status: (child: ParentChild) =>
      options.statuses?.[child.manifest.childId] ?? "active",
    replyPending: (child: ParentChild) =>
      options.pending?.has(child.manifest.childId) ?? false,
  } as ParentRuntime;
}

function expectExactWidth(lines: readonly string[], width: number): void {
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) expect(visibleWidth(line)).toBe(width);
}

type ResultRenderer = Parameters<ExtensionAPI["registerMessageRenderer"]>[1];

function resultRenderer(): ResultRenderer {
  let renderer: ResultRenderer | undefined;
  const pi = {
    on() {},
    registerMessageRenderer(_customType: string, registered: ResultRenderer) {
      renderer = registered;
    },
  } as unknown as ExtensionAPI;

  ParentUI.register(pi, makeRuntime([]));
  expect(renderer).toBeDefined();

  return renderer as ResultRenderer;
}

const plainTheme = {
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
} as Theme;
const markedTheme = {
  ...plainTheme,
  fg: (color: string, text: string) =>
    color === "dim" || color === "muted"
      ? `<${color}>${text}</${color}>`
      : text,
} as Theme;

function renderParentQuestion(options: {
  readonly description: string;
  readonly expanded?: boolean;
  readonly question: string;
  readonly sessionPath?: string;
  readonly theme?: Theme;
}): string {
  const sessionPath = options.sessionPath ?? "/tmp/child/session.jsonl";
  const component = resultRenderer()(
    {
      role: "custom",
      customType: "side-quest-result",
      content: `Subagent asks: ${options.question}\nResume: ${sessionPath}`,
      display: true,
      details: {
        kind: "parent-request",
        subagentType: "general-purpose",
        description: options.description,
        question: options.question,
        sessionPath,
      },
      timestamp: NOW,
    },
    { expanded: options.expanded ?? false, outputPad: 0 },
    options.theme ?? plainTheme,
  );

  return component?.render(500).join("\n") ?? "";
}

beforeEach(() => {
  initTheme("dark", false);
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

test("parent widget stays hidden without children or below its minimum width", () => {
  const child = makeChild("child-1");

  expect(ParentUI.renderWidget(makeRuntime([]), 80)).toEqual([]);
  for (const width of [0, 1, 2, 3])
    expect(ParentUI.renderWidget(makeRuntime([child]), width)).toEqual([]);
});

test.each([6, 20, 44, 80, 120])(
  "parent widget renders every line at exactly %i terminal cells",
  (width) => {
    const children = [
      makeChild("child-1"),
      makeChild("child-2", {
        displayName: "代理🤖",
        description: "修正🚀レイアウトの境界を確認する",
      }),
    ];

    expectExactWidth(
      ParentUI.renderWidget(makeRuntime(children), width),
      width,
    );
  },
);

test("parent widget fits its declared four-cell minimum", () => {
  const rendered = ParentUI.renderWidget(
    makeRuntime([makeChild("child-1")]),
    4,
  );

  expectExactWidth(rendered, 4);
});

test("parent widget preserves activity and reply state at narrow widths", () => {
  const child = makeChild("child-1");
  const runtime = makeRuntime([child], {
    pending: new Set([child.manifest.childId]),
  });
  const rendered = ParentUI.renderWidget(runtime, 44).join("\n");

  expect(rendered).toContain("active · reply needed");
  expect(rendered).toContain("…");
  expect(rendered).toContain("gene…");
});

test("parent widget supports multiple Unicode rows and marks only the selected child ID", () => {
  const children = [
    makeChild("alpha", { description: "first task" }),
    makeChild("beta", {
      displayName: "代理🤖",
      description: "修正🚀レイアウトの境界を確認する",
    }),
    makeChild("gamma", { description: "third task" }),
  ];
  const rendered = ParentUI.renderWidget(makeRuntime(children), 120, "beta");
  const rows = rendered.slice(1, -1);

  expect(rows).toHaveLength(3);
  expect(rows[0]).toMatch(/^│ {2}/);
  expect(rows[1]).toMatch(/^│› /);
  expect(rows[2]).toMatch(/^│ {2}/);
  expect(rows[1]).toContain("代理🤖");
  expectExactWidth(rendered, 120);
});

test("parent widget formats elapsed boundaries deterministically", () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const children = [
    makeChild("elapsed", { createdAt: NOW - 3_723_000 }),
    makeChild("future", { createdAt: NOW + 60_000 }),
  ];
  const rendered = ParentUI.renderWidget(makeRuntime(children), 120).join("\n");

  expect(rendered).toContain("01:02:03");
  expect(rendered).toContain("00:00:00");
});

test("collapsed parent questions use the identity-first banner and truncate after 240 characters", () => {
  const question = "Q".repeat(241);
  const description =
    "Investigate the renderer behavior across narrow terminals, inherited history, and several concurrent parent decisions";
  const rendered = renderParentQuestion({ description, question });

  expect(rendered).toContain("SUBAGENT ASKS  general-purpose");
  expect(rendered).toContain(description);
  expect(rendered).toContain(`${"Q".repeat(240)}… `);
  expect(rendered).toContain("to expand");
  expect(rendered).not.toMatch(/… \([^)]*to expand\)/);
  expect(rendered).not.toContain("Q".repeat(241));
  expect(rendered).not.toContain("/tmp/child/session.jsonl");
});

test("collapsed parent questions use one muted hint tone and reserve dim for the key", () => {
  const rendered = renderParentQuestion({
    description: "Inspect truncation colors",
    question: "Q".repeat(241),
    theme: markedTheme,
  });

  expect(rendered).toContain("<muted>… </muted>");
  expect(rendered).toMatch(/<dim>[^<]*<\/dim><muted> to expand<\/muted>/);
});

test("collapsed parent questions keep short questions without an ellipsis", () => {
  const question = "Which color should I use?";
  const rendered = renderParentQuestion({
    description: "Choose the canonical accent color",
    question,
  });

  expect(rendered).toContain(question);
  expect(rendered).not.toContain(`${question}…`);
  expect(rendered).not.toContain("to expand");
});

test("expanded parent questions show the full question and canonical session path", () => {
  const question = "Q".repeat(241);
  const sessionPath = "/tmp/child/canonical-session.jsonl";
  const rendered = renderParentQuestion({
    description: "Inspect all renderer states",
    expanded: true,
    question,
    sessionPath,
  });

  expect(rendered).toContain(question);
  expect(rendered).not.toContain(`${"Q".repeat(240)}…`);
  expect(rendered).not.toContain("to expand");
  expect(rendered).toContain(`session path: ${sessionPath}`);
});
