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

beforeEach(() => {
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
