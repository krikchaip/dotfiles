import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";

import { copyPackageSnapshot } from "../../package-snapshots.ts";

const roots: string[] = [];

/**
 * Removes test-owned read-only graph views.
 */
function removeFixture(path: string): void {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    chmodSync(path, (stat.mode & 0o777) | 0o700);
    for (const name of readdirSync(path)) removeFixture(join(path, name));
  }
  rmSync(path, { recursive: true, force: true });
}

afterEach(() => {
  for (const root of roots.splice(0)) removeFixture(root);
});

/**
 * Creates small distinct sources under one isolated storage owner.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sq-snapshot-collection-"));
  roots.push(root);
  const owner = join(root, "agent");
  const source = (name: string) => {
    const path = join(root, name);
    mkdirSync(path);
    writeFileSync(
      join(path, "index.js"),
      `export default ${JSON.stringify(name)};\n`,
    );
    return path;
  };
  return { root, owner, source };
}

/**
 * Ages a graph and optionally makes its process lease provably dead.
 */
function ageGraph(owner: string, path: string, dead = true): void {
  const root = dirname(path);
  const marker = join(root, ".package-snapshot.json");
  const value = JSON.parse(readFileSync(marker, "utf8"));
  chmodSync(marker, 0o600);
  writeFileSync(marker, JSON.stringify({ ...value, createdAt: 0 }));
  chmodSync(marker, 0o400);
  if (!dead) return;
  const leases = join(owner, "side-quests", "snapshot-leases", "v3");
  for (const name of readdirSync(leases)) {
    const leasePath = join(leases, name);
    const lease = JSON.parse(readFileSync(leasePath, "utf8"));
    if (lease.directory === value.directory)
      writeFileSync(
        leasePath,
        JSON.stringify({ ...lease, pid: 2_147_483_647 }),
      );
  }
}

test("collection removes only old graphs with dead owners and no saved session", async () => {
  const { owner, source } = fixture();
  const stale = await copyPackageSnapshot(source("stale"), owner, "package");
  ageGraph(owner, stale);
  await copyPackageSnapshot(source("trigger"), owner, "package");
  expect(existsSync(stale)).toBe(false);
});

test("saved manifests and live processes retain old graphs", async () => {
  const { owner, source } = fixture();
  const saved = await copyPackageSnapshot(source("saved"), owner, "package");
  const active = await copyPackageSnapshot(source("active"), owner, "package");
  ageGraph(owner, saved);
  ageGraph(owner, active, false);
  const session = join(owner, "side-quests", "sessions", "parent", "child");
  mkdirSync(session, { recursive: true });
  writeFileSync(
    join(session, "manifest.json"),
    JSON.stringify({
      version: 1,
      parentId: "parent",
      childId: "child",
      sessionPath: join(session, "session.jsonl"),
      extensionPaths: [join(saved, "index.js")],
    }),
  );
  await copyPackageSnapshot(source("trigger"), owner, "package");
  expect(existsSync(saved)).toBe(true);
  expect(existsSync(active)).toBe(true);
});

test("unknown saved ownership blocks all graph deletion", async () => {
  const { owner, source } = fixture();
  const stale = await copyPackageSnapshot(source("stale"), owner, "package");
  ageGraph(owner, stale);
  const session = join(owner, "side-quests", "sessions", "unknown");
  mkdirSync(session, { recursive: true });
  writeFileSync(join(session, "manifest.json"), "not json");
  await copyPackageSnapshot(source("trigger"), owner, "package");
  expect(existsSync(stale)).toBe(true);
});
