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
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import {
  DefaultPackageManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";

import { PiPackageResources } from "../../package-resources.ts";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
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
 * Builds tiny isolated graphs that exceed a deliberately lowered budget.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sq-budget-"));
  roots.push(root);
  const owner = join(root, "agent");
  const sources = ["one", "two"].map((name) => {
    const source = join(root, name);
    mkdirSync(source);
    writeFileSync(join(source, "payload"), Buffer.alloc(96 * 1024, name));
    return source;
  });
  return { root, owner, sources };
}

/**
 * Exercises real worker allocation, bypassing the process-local reuse map.
 */
function capture(source: string, owner: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../../package-snapshot.mjs", import.meta.url),
      { workerData: { source }, execArgv: [] },
    );
    worker.on("error", reject);
    let result: string | undefined;
    let failure: Error | undefined;
    worker.on("message", (message) => {
      if (message.type === "fingerprint")
        worker.postMessage({ agentDirectory: owner, layout: "package" });
      if (message.type === "complete") result = message.destination;
      if (message.type === "error") failure = new Error(message.error);
    });
    worker.on("exit", () => {
      if (failure) reject(failure);
      else if (result) resolve(result);
      else reject(new Error("Worker exited without a result"));
    });
  });
}

test("oversized graph fails before a staging copy is created", async () => {
  vi.stubEnv("PI_SIDE_QUESTS_MAX_RESOURCE_BYTES", String(64 * 1024));
  const { owner, sources } = fixture();
  await expect(capture(sources[0] as string, owner)).rejects.toThrow(
    "resource budget",
  );
  const resources = join(owner, "side-quests", "resources");
  expect(existsSync(resources) ? readdirSync(resources) : []).toEqual([]);
});

test("concurrent different graphs share one allocation budget", async () => {
  vi.stubEnv("PI_SIDE_QUESTS_MAX_RESOURCE_BYTES", String(260 * 1024));
  const { owner, sources } = fixture();
  const results = await Promise.allSettled(
    sources.map((source) => capture(source, owner)),
  );
  expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
    1,
  );
  expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
  expect(readdirSync(join(owner, "side-quests", "resources"))).toHaveLength(1);
  const winner = results.findIndex(({ status }) => status === "fulfilled");
  await expect(capture(sources[winner] as string, owner)).resolves.toBe(
    (results[winner] as PromiseFulfilledResult<string>).value,
  );
});

test("budget refusal releases allocation ownership for a smaller graph", async () => {
  vi.stubEnv("PI_SIDE_QUESTS_MAX_RESOURCE_BYTES", String(128 * 1024));
  const { owner, sources } = fixture();
  await expect(capture(sources[0] as string, owner)).rejects.toThrow(
    "resource budget",
  );
  expect(
    existsSync(join(owner, "side-quests", "resource-allocation.lock")),
  ).toBe(false);
  writeFileSync(join(sources[1] as string, "payload"), "small");
  await expect(capture(sources[1] as string, owner)).resolves.toContain(
    "snapshot-",
  );
});

test("unpublished old resources count toward the budget and are never deleted", async () => {
  vi.stubEnv("PI_SIDE_QUESTS_MAX_RESOURCE_BYTES", String(180 * 1024));
  const { owner, sources } = fixture();
  const orphan = join(owner, "side-quests", "resources", "pending-old");
  mkdirSync(orphan, { recursive: true });
  writeFileSync(join(orphan, "payload"), Buffer.alloc(96 * 1024));
  await expect(capture(sources[0] as string, owner)).rejects.toThrow(
    "resource budget",
  );
  expect(readdirSync(join(owner, "side-quests", "resources"))).toEqual([
    "pending-old",
  ]);
});

test.each(["0", "NaN", String(Number.MAX_SAFE_INTEGER + 1)])(
  "invalid budget %s fails closed",
  async (limit) => {
    vi.stubEnv("PI_SIDE_QUESTS_MAX_RESOURCE_BYTES", limit);
    const { owner, sources } = fixture();
    await expect(capture(sources[0] as string, owner)).rejects.toThrow(
      "Invalid Side Quests resource budget",
    );
    expect(readdirSync(join(owner, "side-quests", "resources"))).toEqual([]);
  },
);

test("a missing online Package installs once before immutable capture", async () => {
  vi.stubEnv("PI_OFFLINE", "0");
  const { owner, root } = fixture();
  const packageName = "sq-missing-budget-fixture";
  const settings = SettingsManager.inMemory({
    packages: [`npm:${packageName}@1.0.0`],
  });
  const manager = new DefaultPackageManager({
    agentDir: owner,
    cwd: root,
    settingsManager: settings,
  });
  const install = vi
    .spyOn(
      DefaultPackageManager.prototype as unknown as {
        runCommandCapture: (...args: unknown[]) => Promise<string>;
      },
      "runCommandCapture",
    )
    .mockImplementation(async () => {
      const directory = join(owner, "npm", "node_modules", packageName);
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, "package.json"),
        JSON.stringify({
          name: packageName,
          version: "1.0.0",
          pi: { extensions: ["index.ts"] },
        }),
      );
      writeFileSync(join(directory, "index.ts"), "export default () => {};\n");
      return "";
    });
  new PiPackageResources(manager, settings, owner);
  const resolved = await manager.resolve();
  expect(install).toHaveBeenCalledTimes(1);
  expect(resolved.extensions).toHaveLength(1);
  expect(resolved.extensions[0]?.path).toContain(
    "/side-quests/resources/snapshot-",
  );
});

test("a changed pinned Git ref is reconciled before immutable capture", async () => {
  vi.stubEnv("PI_OFFLINE", "0");
  const { owner, root } = fixture();
  const source = "git:github.com/example/sq-ref-fixture@2.0.0";
  const settings = SettingsManager.inMemory({ packages: [source] });
  const manager = new DefaultPackageManager({
    agentDir: owner,
    cwd: root,
    settingsManager: settings,
  });
  const native = manager as unknown as {
    parseSource(value: string): unknown;
    getGitInstallPath(parsed: unknown, scope: "user"): string;
    runCommandCapture(
      command: string,
      args: string[],
      options?: { cwd?: string },
    ): Promise<string>;
    installParsedSource(parsed: unknown, scope: "user"): Promise<void>;
  };
  const parsed = native.parseSource(source);
  const directory = native.getGitInstallPath(parsed, "user");
  const writeVersion = (version: string) => {
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({
        name: "sq-ref-fixture",
        version,
        pi: { extensions: ["index.ts"] },
      }),
    );
    writeFileSync(join(directory, "index.ts"), `export default ${version};\n`);
  };
  let head = "old";
  writeVersion("1.0.0");
  vi.spyOn(native, "runCommandCapture").mockImplementation(
    async (_command, args) => (args[1] === "HEAD" ? head : "new"),
  );
  const install = vi
    .spyOn(native, "installParsedSource")
    .mockImplementation(async () => {
      head = "new";
      writeVersion("2.0.0");
    });

  new PiPackageResources(manager, settings, owner);
  const resolved = await manager.resolve();

  expect(install).toHaveBeenCalledTimes(1);
  expect(readFileSync(resolved.extensions[0]?.path ?? "", "utf8")).toContain(
    "2.0.0",
  );
});
