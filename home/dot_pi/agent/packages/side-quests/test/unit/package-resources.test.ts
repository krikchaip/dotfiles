import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  DefaultPackageManager,
  SettingsManager,
  type SourceInfo,
} from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";

import { PiPackageResources } from "../../package-resources.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeFixture(root);
});

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

/**
 * Creates a mutable warm graph and independent runtime-generation adapters.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "side-quests-reusable-graph-"));
  roots.push(root);
  const graph = join(root, "installed", "node_modules");
  const pkg = join(graph, "sq-reuse-fixture");
  mkdirSync(pkg, { recursive: true });
  const entry = join(pkg, "index.ts");
  writeFileSync(entry, "export default () => {};\n");
  writeFileSync(join(pkg, "support.txt"), "Original supporting bytes");
  const sourceInfo: SourceInfo = {
    path: entry,
    source: "npm:sq-reuse-fixture@1.0.0",
    origin: "package",
    scope: "user",
    baseDir: pkg,
  };
  const settings = SettingsManager.inMemory({});
  const capture = (owner = root) => {
    const manager = new DefaultPackageManager({
      agentDir: owner,
      cwd: root,
      settingsManager: settings,
    });
    return new PiPackageResources(manager, settings, owner).freeze(
      entry,
      sourceInfo,
    );
  };
  return { root, graph, pkg, entry, capture };
}

/**
 * Exposes the private Pi command seam wrapped by the resource adapter.
 */
function commandManager(manager: DefaultPackageManager) {
  return manager as unknown as {
    runCommand(
      command: string,
      args: string[],
      options?: { cwd?: string },
    ): Promise<void>;
    runCommandCapture(
      command: string,
      args: string[],
      options?: { cwd?: string },
    ): Promise<string>;
  };
}

test("Package install commands capture output instead of inheriting the parent terminal", async () => {
  const root = mkdtempSync(join(tmpdir(), "sq-quiet-package-command-"));
  roots.push(root);
  const settings = SettingsManager.inMemory({});
  const manager = new DefaultPackageManager({
    agentDir: root,
    cwd: root,
    settingsManager: settings,
  });
  const native = commandManager(manager);
  const capture = vi
    .spyOn(native, "runCommandCapture")
    .mockResolvedValue("installer output");

  new PiPackageResources(manager, settings, root);
  await native.runCommand("npm", ["install"], { cwd: root });

  expect(capture).toHaveBeenCalledWith("npm", ["install"], { cwd: root });
});

test("Package install command failures retain only a bounded diagnostic tail", async () => {
  const root = mkdtempSync(join(tmpdir(), "sq-package-command-error-"));
  roots.push(root);
  const settings = SettingsManager.inMemory({});
  const manager = new DefaultPackageManager({
    agentDir: root,
    cwd: root,
    settingsManager: settings,
  });
  const native = commandManager(manager);
  vi.spyOn(native, "runCommandCapture").mockRejectedValue(
    new Error(`${"discarded-output-".repeat(2_000)}FINAL INSTALL ERROR`),
  );

  new PiPackageResources(manager, settings, root);
  let failure: Error | undefined;
  try {
    await native.runCommand("npm", ["install"], { cwd: root });
  } catch (cause) {
    if (cause instanceof Error) failure = cause;
  }
  if (!failure) throw new Error("Expected the captured command to fail");

  expect(failure.message).toMatch(/^\[\d+ earlier bytes omitted\]\n/);
  expect(failure.message).toContain("FINAL INSTALL ERROR");
  expect(Buffer.byteLength(failure.message)).toBeLessThan(17 * 1024);
});

test("unchanged remote graphs remain reusable across parent runtime generations", async () => {
  const { capture } = fixture();
  const first = await capture();
  expect(await capture()).toBe(first);
  expect(readFileSync(join(dirname(first), "support.txt"), "utf8")).toBe(
    "Original supporting bytes",
  );
});

test("concurrent runtime generations share one durable graph", async () => {
  const { root, capture } = fixture();
  const paths = await Promise.all(Array.from({ length: 4 }, () => capture()));
  expect(new Set(paths).size).toBe(1);
  expect(readdirSync(join(root, "side-quests", "resources"))).toHaveLength(1);
});

test("supporting-file edits invalidate reuse even when package version is unchanged", async () => {
  const { pkg, capture } = fixture();
  const first = await capture();
  writeFileSync(join(pkg, "support.txt"), "Replacement supporting bytes");
  const second = await capture();
  expect(second).not.toBe(first);
  expect(readFileSync(join(dirname(first), "support.txt"), "utf8")).toBe(
    "Original supporting bytes",
  );
  expect(readFileSync(join(dirname(second), "support.txt"), "utf8")).toBe(
    "Replacement supporting bytes",
  );
  expect(await capture()).toBe(second);
});

test("separate resource owners do not share storage", async () => {
  const { root, capture } = fixture();
  const first = await capture();
  const second = await capture(join(root, "other-owner"));
  expect(second).not.toBe(first);
});

test("removed test-owned cached storage is rebuilt once for concurrent callers", async () => {
  const { root, capture } = fixture();
  const first = await capture();
  removeFixture(join(dirname(first), "..", ".."));
  const [second, third] = await Promise.all([capture(), capture()]);
  expect(second).not.toBe(first);
  expect(third).toBe(second);
  expect(readdirSync(join(root, "side-quests", "resources"))).toHaveLength(1);
});

test("one resolver refreshes a changed warm graph without changing earlier snapshots", async () => {
  const root = mkdtempSync(join(tmpdir(), "sq-warm-resolver-refresh-"));
  roots.push(root);
  const pkg = join(root, "npm", "node_modules", "sq-warm-fixture");
  const skills = join(pkg, "skills");
  mkdirSync(skills, { recursive: true });
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({
      name: "sq-warm-fixture",
      version: "1.0.0",
      pi: { skills: ["skills"] },
    }),
  );
  writeFileSync(
    join(skills, "SKILL.md"),
    "---\nname: fixture\ndescription: Fixture\n---\nInstructions.\n",
  );
  writeFileSync(join(skills, "support.txt"), "Original support");
  const settings = SettingsManager.inMemory({
    packages: ["npm:sq-warm-fixture@1.0.0"],
  });
  const manager = new DefaultPackageManager({
    agentDir: root,
    cwd: root,
    settingsManager: settings,
  });
  new PiPackageResources(manager, settings, root);
  const first = (await manager.resolve()).skills.find(
    ({ metadata }) => metadata.source === "npm:sq-warm-fixture@1.0.0",
  )?.path;
  expect(first).toBeDefined();
  writeFileSync(join(skills, "support.txt"), "Changed support");
  const second = (await manager.resolve()).skills.find(
    ({ metadata }) => metadata.source === "npm:sq-warm-fixture@1.0.0",
  )?.path;
  expect(second).not.toBe(first);
  expect(readFileSync(join(dirname(first ?? ""), "support.txt"), "utf8")).toBe(
    "Original support",
  );
  expect(readFileSync(join(dirname(second ?? ""), "support.txt"), "utf8")).toBe(
    "Changed support",
  );
});

test("a failed graph capture does not poison the next generation", async () => {
  const { graph, capture } = fixture();
  const broken = join(graph, "broken-dependency");
  symlinkSync(join(graph, "missing-dependency"), broken);
  await expect(capture()).rejects.toThrow("Package snapshot");
  rmSync(broken);
  expect(readFileSync(await capture(), "utf8")).toContain("export default");
});
