import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";

import { AgentRenderer } from "../../agent-renderer.ts";

const temporaryDirectories: string[] = [];

function syntheticSession(name: string): string {
  return `/tmp/side-quests-agent-renderer-${name}/session.jsonl`;
}

function managedSession(
  inheritContext: boolean,
  lifecycle: "autonomous" | "interactive",
): string {
  const directory = mkdtempSync(join(tmpdir(), "side-quests-renderer-"));
  temporaryDirectories.push(directory);
  const sessionPath = join(directory, "session.jsonl");
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({
      version: 1,
      childId: "child-id",
      parentId: "parent-id",
      ownerId: "owner-id",
      sessionPath,
      cwd: "/tmp",
      agentName: "general-purpose",
      displayName: "general-purpose",
      description: "renderer test",
      lifecycle,
      inheritContext,
      tools: ["read"],
      createdAt: Date.now(),
    }),
  );
  return sessionPath;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { force: true, recursive: true });
});

test("formats fresh and resumed Agent headers", () => {
  expect(
    AgentRenderer.summary({
      subagent_type: "general-purpose",
      description: "review the renderer",
      prompt: "Review it.",
    }),
  ).toBe("general-purpose :: review the renderer");

  expect(
    AgentRenderer.summary({
      resume: "/tmp/child/session.jsonl",
      description: "continue the review",
      prompt: "Continue.",
    }),
  ).toBe("general-purpose (resumed) :: continue the review");
});

test("collapsed launch status shows only effective true values", () => {
  expect(
    AgentRenderer.collapsedStatuses({}, syntheticSession("defaults")),
  ).toEqual(["inherited"]);
  expect(
    AgentRenderer.collapsedStatuses(
      { inherit_context: false },
      syntheticSession("isolated"),
    ),
  ).toEqual([]);
  expect(
    AgentRenderer.collapsedStatuses(
      { inherit_context: false, interactive: true },
      syntheticSession("interactive"),
    ),
  ).toEqual(["interactive"]);
});

test("collapsed resume status is always hidden", () => {
  expect(
    AgentRenderer.collapsedStatuses(
      {
        resume: "/tmp/child/session.jsonl",
        inherit_context: true,
        interactive: true,
      },
      syntheticSession("resume"),
    ),
  ).toEqual([]);
});

test("expanded launch shows booleans while expanded resume omits them", () => {
  expect(
    AgentRenderer.expandedResultLines(
      { inherit_context: false, interactive: true },
      "/tmp/fresh/session.jsonl",
      "Review the UI.",
    ),
  ).toEqual([
    "inherit_context: false · interactive: true",
    "session path: /tmp/fresh/session.jsonl",
    "⠀",
    "Review the UI.",
  ]);

  expect(
    AgentRenderer.expandedResultLines(
      { resume: "/tmp/resumed/session.jsonl" },
      "/tmp/resumed/session.jsonl",
      "Continue the UI review.",
    ),
  ).toEqual([
    "session path: /tmp/resumed/session.jsonl",
    "⠀",
    "Continue the UI review.",
  ]);
});

test("persisted manifest values override passed Agent parameters", () => {
  const sessionPath = managedSession(false, "interactive");
  const args = { inherit_context: true, interactive: false };

  expect(AgentRenderer.collapsedStatuses(args, sessionPath)).toEqual([
    "interactive",
  ]);
  expect(
    AgentRenderer.expandedResultLines(args, sessionPath, "Test precedence.")[0],
  ).toBe("inherit_context: false · interactive: true");
});
