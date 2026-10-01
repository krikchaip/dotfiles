import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
 * Creates a small authored graph and an isolated storage owner.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sq-proportional-storage-"));
  roots.push(root);
  const source = join(root, "installed");
  const owner = join(root, "agent");
  mkdirSync(source);
  writeFileSync(join(source, "unchanged"), Buffer.alloc(64 * 1024, 7));
  writeFileSync(join(source, "version"), "v1");
  return { source, owner };
}

test("default storage has no fixed byte cap", () => {
  const module = fileURLToPath(
    new URL("../../package-budget.mjs", import.meta.url),
  );
  const value = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `delete process.env.PI_SIDE_QUESTS_MAX_RESOURCE_BYTES; const { resourceBudget } = await import(${JSON.stringify(module)}); console.log(String(resourceBudget()));`,
    ],
    { encoding: "utf8" },
  );
  expect(value.trim()).toBe("Infinity");
});

test("metadata-only source changes reuse the stored content generation", async () => {
  const { source, owner } = fixture();
  const first = await copyPackageSnapshot(source, owner, "package");
  const future = new Date(Date.now() + 60000);
  utimesSync(join(source, "unchanged"), future, future);
  expect(await copyPackageSnapshot(source, owner, "package")).toBe(first);
});

test("changed versions share unchanged files without sharing mutable installed bytes", async () => {
  const { source, owner } = fixture();
  const first = await copyPackageSnapshot(source, owner, "package");
  writeFileSync(join(source, "version"), "v2");
  const second = await copyPackageSnapshot(source, owner, "package");
  expect(second).not.toBe(first);
  expect(lstatSync(join(second, "unchanged")).ino).toBe(
    lstatSync(join(first, "unchanged")).ino,
  );
  expect(lstatSync(join(first, "unchanged")).ino).not.toBe(
    lstatSync(join(source, "unchanged")).ino,
  );
  expect(lstatSync(join(second, "unchanged")).mode & 0o222).toBe(0);
  expect(readFileSync(join(first, "version"), "utf8")).toBe("v1");
  expect(readFileSync(join(second, "version"), "utf8")).toBe("v2");
});
