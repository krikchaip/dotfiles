import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";

import { JsonStore, STORE_VERSION } from "../../store/json.ts";
import { RuntimeStore } from "../../store/runtime.ts";

const originalRoot = process.env.PI_CODING_AGENT_DIR;
const temporaryRoots: string[] = [];

afterEach(() => {
  process.env.PI_CODING_AGENT_DIR = originalRoot;
  for (const root of temporaryRoots.splice(0))
    rmSync(root, { force: true, recursive: true });
});

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "side-quests-runtime-store-"));
  temporaryRoots.push(root);
  process.env.PI_CODING_AGENT_DIR = root;
  return root;
}

function childStatePath(root: string, name: string): string {
  return join(
    root,
    "side-quests",
    "runtime",
    "parent-id",
    "children",
    "child-id",
    name,
  );
}

const activity = {
  version: STORE_VERSION,
  childId: "child-id",
  sequence: 3,
  eventAt: 1_000,
  heartbeatAt: 2_000,
  phase: "active",
  scope: "tool",
  toolName: "read",
  lifecycle: "interactive",
  pendingRequest: true,
} as const;

const terminal = {
  version: STORE_VERSION,
  eventId: "event-id",
  childId: "child-id",
  kind: "completed",
  createdAt: 3_000,
  response: "Completed work.",
} as const;

test("round-trips a valid activity snapshot", () => {
  temporaryRoot();
  const { version: _version, ...state } = activity;

  RuntimeStore.writeActivity("parent-id", state);

  expect(RuntimeStore.readActivity("parent-id", "child-id")).toEqual(activity);
});

test.each([
  { version: STORE_VERSION + 1 },
  { childId: "different-child" },
  { sequence: 1.5 },
  { eventAt: "now" },
  { heartbeatAt: null },
  { phase: "finished" },
  { lifecycle: "detached" },
  { pendingRequest: "yes" },
  { scope: "network" },
  { toolName: 42 },
])("rejects an invalid activity snapshot %#", (update) => {
  const root = temporaryRoot();
  JsonStore.write(childStatePath(root, "activity.json"), {
    ...activity,
    ...update,
  });

  expect(RuntimeStore.readActivity("parent-id", "child-id")).toBeUndefined();
});

test("round-trips and clears a valid terminal outcome", () => {
  temporaryRoot();
  const { version: _version, ...state } = terminal;

  RuntimeStore.writeTerminal("parent-id", state);

  expect(RuntimeStore.hasTerminal("parent-id", "child-id")).toBe(true);
  expect(RuntimeStore.readTerminal("parent-id", "child-id")).toEqual(terminal);
  RuntimeStore.clearTerminal("parent-id", "child-id");
  RuntimeStore.clearTerminal("parent-id", "child-id");
  expect(RuntimeStore.hasTerminal("parent-id", "child-id")).toBe(false);
});

test.each([
  { version: STORE_VERSION + 1 },
  { eventId: 42 },
  { childId: "different-child" },
  { kind: "running" },
  { createdAt: "now" },
  { response: 42 },
  { error: false },
])("rejects an invalid terminal outcome %#", (update) => {
  const root = temporaryRoot();
  JsonStore.write(childStatePath(root, "terminal.json"), {
    ...terminal,
    ...update,
  });

  expect(RuntimeStore.readTerminal("parent-id", "child-id")).toBeUndefined();
});

test("reports a malformed terminal file as present until it is cleared", () => {
  const root = temporaryRoot();
  const path = childStatePath(root, "terminal.json");
  JsonStore.write(path, terminal);
  writeFileSync(path, "not-json");

  expect(RuntimeStore.hasTerminal("parent-id", "child-id")).toBe(true);
  expect(RuntimeStore.readTerminal("parent-id", "child-id")).toBeUndefined();
  RuntimeStore.clearTerminal("parent-id", "child-id");
  expect(RuntimeStore.hasTerminal("parent-id", "child-id")).toBe(false);
});
