import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";

import { JsonStore, STORE_VERSION } from "../../store/json.ts";
import { RuntimeStore } from "../../store/runtime.ts";
import { type CreateSessionParams, SessionStore } from "../../store/session.ts";

const originalRoot = process.env.PI_CODING_AGENT_DIR;
const temporaryRoots: string[] = [];

afterEach(() => {
  process.env.PI_CODING_AGENT_DIR = originalRoot;
  for (const root of temporaryRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "side-quests-store-"));
  temporaryRoots.push(root);
  process.env.PI_CODING_AGENT_DIR = root;
  return root;
}

function createManagedSession(
  update: Partial<CreateSessionParams> = {},
): ReturnType<typeof SessionStore.createSync> {
  const root = temporaryRoot();
  return SessionStore.createSync({
    parentId: "parent-id",
    childId: "child-id",
    ownerId: "owner-id",
    cwd: root,
    description: "verify managed storage",
    lifecycle: "autonomous",
    inheritContext: false,
    tools: ["read"],
    ...update,
  });
}

test("creates a private managed session with a canonical resumable path", () => {
  const manifest = createManagedSession();

  expect(manifest.sessionPath).toContain(
    "/side-quests/sessions/parent-id/child-id/session.jsonl",
  );
  expect(SessionStore.readResumableManifest(manifest.sessionPath)).toEqual(
    manifest,
  );
});

test("persists a correlated continuation and lifecycle promotion", () => {
  const manifest = createManagedSession();
  const promoted = SessionStore.updateManifest(manifest, {
    description: "apply review feedback",
    lifecycle: "interactive",
  });
  SessionStore.writeResponse(manifest.parentId, {
    responseId: "response-id",
    requestId: "request-id",
    childId: manifest.childId,
    prompt: "Apply the review feedback.",
    createdAt: Date.now(),
  });

  expect(promoted.lifecycle).toBe("interactive");
  expect(
    SessionStore.readResponse(manifest.parentId, manifest.childId),
  ).toMatchObject({
    requestId: "request-id",
    childId: "child-id",
  });
  SessionStore.clearResponse(manifest.parentId, manifest.childId);
  expect(
    SessionStore.readResponse(manifest.parentId, manifest.childId),
  ).toBeUndefined();
});

test("persists private owner and canonical pane state", () => {
  const manifest = createManagedSession();
  RuntimeStore.writeOwner({
    parentId: manifest.parentId,
    ownerId: manifest.ownerId,
    pid: process.pid,
    startedAt: 1,
    leaseAt: 2,
    windowId: "@1",
  });
  RuntimeStore.writeChildRuntime({
    parentId: manifest.parentId,
    childId: manifest.childId,
    paneId: "%1",
    windowId: "@1",
    startedAt: 3,
  });

  const runtimeDirectory = join(
    manifest.cwd,
    "side-quests",
    "runtime",
    manifest.parentId,
  );
  expect(
    JSON.parse(readFileSync(join(runtimeDirectory, "owner.json"), "utf8")),
  ).toMatchObject({
    ownerId: "owner-id",
    windowId: "@1",
  });
  expect(
    JSON.parse(
      readFileSync(
        join(runtimeDirectory, "children", manifest.childId, "child.json"),
        "utf8",
      ),
    ),
  ).toMatchObject({
    paneId: "%1",
    windowId: "@1",
  });
});

test("rejects a symlink that points at a managed child session", () => {
  const manifest = createManagedSession();
  const alias = join(tmpdir(), `side-quests-alias-${Date.now()}.jsonl`);
  symlinkSync(manifest.sessionPath, alias);
  temporaryRoots.push(alias);

  expect(SessionStore.readResumableManifest(alias)).toBeUndefined();
});

test("inherits valid parent entries without copying its session header", async () => {
  const root = temporaryRoot();
  const parentSession = join(root, "parent.jsonl");
  writeFileSync(
    parentSession,
    [
      JSON.stringify({ type: "session", id: "parent-id" }),
      JSON.stringify({ type: "message", id: "first" }),
      "not-json",
      "null",
      JSON.stringify({ type: "message", id: "second" }),
      "",
    ].join("\n"),
  );
  const manifest = await SessionStore.create({
    parentId: "parent-id",
    childId: "inherited-child",
    ownerId: "owner-id",
    cwd: root,
    description: "inherit parent context",
    lifecycle: "autonomous",
    inheritContext: true,
    parentSessionPath: parentSession,
    tools: ["read"],
  });

  const entries = readFileSync(manifest.sessionPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

  expect(entries[0]).toMatchObject({
    type: "session",
    id: "inherited-child",
    parentSession,
  });
  expect(entries.slice(1)).toEqual([
    { type: "message", id: "first" },
    { type: "message", id: "second" },
  ]);
});

test("does not inherit parent entries when inheritance is disabled", async () => {
  const root = temporaryRoot();
  const parentSession = join(root, "parent.jsonl");
  writeFileSync(
    parentSession,
    `${JSON.stringify({ type: "session", id: "parent-id" })}\n${JSON.stringify({ type: "message", id: "parent-message" })}\n`,
  );
  const manifest = await SessionStore.create({
    parentId: "parent-id",
    childId: "isolated-child",
    ownerId: "owner-id",
    cwd: root,
    description: "start without parent context",
    lifecycle: "autonomous",
    inheritContext: false,
    parentSessionPath: parentSession,
    tools: ["read"],
  });

  const entries = readFileSync(manifest.sessionPath, "utf8")
    .split("\n")
    .filter(Boolean);

  expect(entries).toHaveLength(1);
});

test.each([
  ["request", { version: STORE_VERSION + 1 }],
  ["request", { childId: "different-child" }],
  ["request", { createdAt: "now" }],
  ["response", { version: STORE_VERSION + 1 }],
  ["response", { childId: "different-child" }],
  ["response", { requestId: 42 }],
])("rejects an invalid %s mailbox record", (name, update) => {
  const manifest = createManagedSession();
  const path = join(dirname(manifest.sessionPath), "mailbox", `${name}.json`);
  const common = {
    version: STORE_VERSION,
    childId: manifest.childId,
    prompt: "Continue with the test.",
    createdAt: Date.now(),
  };
  const value =
    name === "request"
      ? { ...common, requestId: "request-id", ...update }
      : { ...common, responseId: "response-id", ...update };
  JsonStore.write(path, value);

  const read =
    name === "request"
      ? SessionStore.readRequest(manifest.parentId, manifest.childId)
      : SessionStore.readResponse(manifest.parentId, manifest.childId);

  expect(read).toBeUndefined();
});

test("rejects a manifest with an invalid lifecycle", () => {
  const manifest = createManagedSession();
  const path = join(dirname(manifest.sessionPath), "manifest.json");
  JsonStore.write(path, { ...manifest, lifecycle: "detached" });

  expect(SessionStore.readManifest(manifest.sessionPath)).toBeUndefined();
});
