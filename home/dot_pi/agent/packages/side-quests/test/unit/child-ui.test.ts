import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { ChildRuntime } from "../../child/runtime.ts";
import { ChildUI } from "../../child/ui.ts";
import type { ChildManifest, Lifecycle } from "../../store/session.ts";

const NOW = Date.UTC(2025, 0, 2, 3, 4, 5);

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
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
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
