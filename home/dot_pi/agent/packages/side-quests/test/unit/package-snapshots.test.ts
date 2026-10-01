import { type ChildProcess, execFileSync, spawn } from "node:child_process";
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
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { afterEach, expect, test, vi } from "vitest";

import { copyPackageSnapshot } from "../../package-snapshots.ts";

const roots: string[] = [];
const children = new Set<ChildProcess>();
const modulePath = fileURLToPath(
  new URL("../../package-snapshots.ts", import.meta.url),
);

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    [...children].map(
      (child) =>
        new Promise<void>((resolve) => {
          child.once("exit", () => resolve());
          child.kill("SIGKILL");
        }),
    ),
  );
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
 * Creates package bytes outside the resource owner and a fresh-process driver.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sq-persistent-snapshots-"));
  roots.push(root);
  const source = join(root, "installed");
  const owner = join(root, "agent");
  mkdirSync(source);
  writeFileSync(join(source, "index.ts"), "export default () => {};\n");
  writeFileSync(join(source, "support.txt"), "original");
  const driver = join(root, "capture.mjs");
  writeFileSync(
    driver,
    `import { createRequire } from "node:module";
import { existsSync } from "node:fs";
const { createJiti } = createRequire(${JSON.stringify(modulePath)})("jiti");
const { copyPackageSnapshot } = await createJiti(import.meta.url, { fsCache: false }).import(${JSON.stringify(modulePath)});
try {
  if (process.argv[5]) {
    process.send("ready");
    const deadline = Date.now() + 5000;
    while (!existsSync(process.argv[5])) {
      if (Date.now() > deadline) throw new Error("Cold-start gate timed out");
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
  console.log(await copyPackageSnapshot(process.argv[2], process.argv[3], process.argv[4]));
} catch (error) { console.error(error.message); process.exitCode = 1; }
`,
  );
  return { root, source, owner, driver };
}

/**
 * Captures with a real separate Node process rather than clearing module state.
 */
function capture(
  driver: string,
  source: string,
  owner: string,
  layout = "package",
  gate?: string,
  onReady?: () => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [driver, source, owner, layout, ...(gate ? [gate] : [])],
      { stdio: ["ignore", "pipe", "pipe", "ipc"] },
    );
    children.add(child);
    child.on("message", (message) => {
      if (message === "ready") onReady?.();
    });
    let output = "";
    let error = "";
    child.stdout?.on("data", (bytes) => {
      output += String(bytes);
    });
    child.stderr?.on("data", (bytes) => {
      error += String(bytes);
    });
    child.on("error", (cause) => {
      children.delete(child);
      reject(cause);
    });
    child.on("exit", (code) => {
      children.delete(child);
      if (code === 0) resolve(output.trim());
      else reject(new Error(error.trim() || `Capture exited ${code}`));
    });
  });
}

test("independent processes cannot allocate beyond their shared resource budget", async () => {
  vi.stubEnv("PI_SIDE_QUESTS_MAX_RESOURCE_BYTES", String(260 * 1024));
  const { root, driver, source, owner } = fixture();
  const other = join(root, "second-source");
  mkdirSync(other);
  writeFileSync(join(source, "large"), Buffer.alloc(96 * 1024, 1));
  writeFileSync(join(other, "large"), Buffer.alloc(96 * 1024, 2));
  const results = await Promise.allSettled([
    capture(driver, source, owner),
    capture(driver, other, owner),
  ]);
  expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
    1,
  );
  expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
  expect(readdirSync(join(owner, "side-quests", "resources"))).toHaveLength(1);
});

test("another Pi process reuses the completed immutable graph", async () => {
  const { driver, source, owner } = fixture();
  const first = await capture(driver, source, owner);
  expect(await capture(driver, source, owner)).toBe(first);
  expect(readdirSync(join(owner, "side-quests", "resources"))).toHaveLength(1);
});

test("concurrent independent processes retain one graph and return the same path", async () => {
  const { root, driver, source, owner } = fixture();
  const gate = join(root, "release-cold-starts");
  let readyCount = 0;
  let releaseReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    releaseReady = resolve;
  });
  const competitors = Array.from({ length: 4 }, () =>
    capture(driver, source, owner, "package", gate, () => {
      if (++readyCount === 4) releaseReady();
    }),
  );
  await Promise.race([
    ready,
    Promise.all(competitors).then(() => {
      throw new Error("Cold competitors exited before the gate opened");
    }),
  ]);
  writeFileSync(gate, "go");
  const paths = await Promise.all(competitors);
  expect(new Set(paths).size).toBe(1);
  expect(readdirSync(join(owner, "side-quests", "resources"))).toHaveLength(1);
  expect(readFileSync(join(paths[0] as string, "support.txt"), "utf8")).toBe(
    "original",
  );
});

test("a new process preserves the old graph after a supporting-file mutation", async () => {
  const { driver, source, owner } = fixture();
  const first = await capture(driver, source, owner);
  writeFileSync(join(source, "support.txt"), "replacement");
  const second = await capture(driver, source, owner);
  expect(second).not.toBe(first);
  expect(await capture(driver, source, owner)).toBe(second);
  expect(readFileSync(join(first, "support.txt"), "utf8")).toBe("original");
  expect(readFileSync(join(second, "support.txt"), "utf8")).toBe("replacement");
});

test("resource owners and copy layouts remain independent", async () => {
  const { root, driver, source, owner } = fixture();
  const first = await capture(driver, source, owner);
  const second = await capture(driver, source, join(root, "other-agent"));
  const npm = await capture(driver, source, owner, "node_modules");
  expect(second).not.toBe(first);
  expect(npm).not.toBe(first);
  expect(npm.endsWith("/node_modules")).toBe(true);
});

test("removed test-owned storage rebuilds once across independent processes", async () => {
  const { driver, source, owner } = fixture();
  const first = await capture(driver, source, owner);
  removeFixture(dirname(first));
  const paths = await Promise.all(
    Array.from({ length: 3 }, () => capture(driver, source, owner)),
  );
  expect(paths[0]).not.toBe(first);
  expect(new Set(paths).size).toBe(1);
  expect(readdirSync(join(owner, "side-quests", "resources"))).toHaveLength(1);
});

test("a failed graph does not publish a partial generation or poison another process", async () => {
  const { driver, source, owner } = fixture();
  const broken = join(source, "broken");
  symlinkSync(join(source, "missing"), broken);
  await expect(capture(driver, source, owner)).rejects.toThrow(
    "Package snapshot",
  );
  rmSync(broken);
  const copied = await capture(driver, source, owner);
  expect(await capture(driver, source, owner)).toBe(copied);
  expect(readFileSync(join(copied, "support.txt"), "utf8")).toBe("original");
});

test("repeated deletion follows immutable repair records without replacing old records", async () => {
  const { driver, source, owner } = fixture();
  const first = await capture(driver, source, owner);
  const index = join(owner, "side-quests", "snapshot-index", "v3");
  const originalRecord = join(index, readdirSync(index)[0] as string);
  const originalBytes = readFileSync(originalRecord, "utf8");
  removeFixture(dirname(first));
  const second = await capture(driver, source, owner);
  removeFixture(dirname(second));
  const [third, fourth] = await Promise.all([
    capture(driver, source, owner),
    capture(driver, source, owner),
  ]);
  expect(third).toBe(fourth);
  expect(third).not.toBe(second);
  expect(readFileSync(originalRecord, "utf8")).toBe(originalBytes);
  expect(readdirSync(index)).toHaveLength(3);
  expect(readdirSync(join(owner, "side-quests", "resources"))).toHaveLength(1);
});

test("dereferenced dependencies remain independent of mutable installed bytes", async () => {
  const { root, driver, source, owner } = fixture();
  const dependency = join(root, "shared-dependency");
  mkdirSync(dependency);
  writeFileSync(join(dependency, "index.js"), "original dependency");
  symlinkSync(dependency, join(source, "dependency"));
  const first = await capture(driver, source, owner, "node_modules");
  writeFileSync(join(dependency, "index.js"), "changed dependency");
  const second = await capture(driver, source, owner, "node_modules");
  expect(second).not.toBe(first);
  expect(readFileSync(join(first, "dependency", "index.js"), "utf8")).toBe(
    "original dependency",
  );
  expect(readFileSync(join(second, "dependency", "index.js"), "utf8")).toBe(
    "changed dependency",
  );
});

test("invalid index records fail closed without deleting an existing generation", async () => {
  const { driver, source, owner } = fixture();
  const first = await capture(driver, source, owner);
  const index = join(owner, "side-quests", "snapshot-index", "v3");
  const recordPath = join(index, readdirSync(index)[0] as string);
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  writeFileSync(
    recordPath,
    JSON.stringify({ ...record, directory: "../outside-owner" }),
  );
  await expect(capture(driver, source, owner)).rejects.toThrow(
    "Invalid package snapshot index",
  );
  expect(readFileSync(join(first, "support.txt"), "utf8")).toBe("original");
  expect(readdirSync(join(owner, "side-quests", "resources"))).toHaveLength(1);
});

test("failure after fingerprinting cleans staging and never publishes a partial graph", async () => {
  const { driver, source, owner } = fixture();
  const worker = new Worker(
    new URL("../../package-snapshot.mjs", import.meta.url),
    { workerData: { source }, execArgv: [] },
  );
  let error = "";
  const completion = new Promise<void>((resolve, reject) => {
    worker.on("error", reject);
    worker.on("message", (message) => {
      if (message.type === "fingerprint") {
        symlinkSync(join(source, "missing"), join(source, "broken"));
        worker.postMessage({ agentDirectory: owner, layout: "package" });
      } else if (message.type === "error") error = message.error;
    });
    worker.on("exit", () => resolve());
  });
  await completion;
  expect(error).not.toBe("");
  expect(readdirSync(join(owner, "side-quests", "resources"))).toHaveLength(0);
  expect(
    readdirSync(join(owner, "side-quests", "snapshot-index", "v3")),
  ).toHaveLength(0);
  rmSync(join(source, "broken"));
  const copied = await capture(driver, source, owner);
  expect(await capture(driver, source, owner)).toBe(copied);
});

test("external file links copy bytes and preserve saved generations after mutation", async () => {
  const { root, driver, source, owner } = fixture();
  const external = join(root, "external.txt");
  writeFileSync(external, "original external bytes");
  symlinkSync(external, join(source, "file-link.txt"));
  const first = await capture(driver, source, owner);
  expect(lstatSync(join(first, "file-link.txt")).isSymbolicLink()).toBe(false);
  writeFileSync(external, "replacement external bytes");
  const second = await capture(driver, source, owner);
  expect(second).not.toBe(first);
  expect(await capture(driver, source, owner)).toBe(second);
  const reopened = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { readFileSync } from "node:fs"; process.stdout.write(readFileSync(${JSON.stringify(join(first, "file-link.txt"))}, "utf8"));`,
    ],
    { encoding: "utf8" },
  );
  expect(reopened).toBe("original external bytes");
  expect(readFileSync(join(second, "file-link.txt"), "utf8")).toBe(
    "replacement external bytes",
  );
});

test("regular files retain execute permissions and directories retain necessary modes", async () => {
  const { driver, source, owner } = fixture();
  chmodSync(source, 0o750);
  chmodSync(join(source, "index.ts"), 0o751);
  const copied = await capture(driver, source, owner);
  expect(lstatSync(copied).mode & 0o777).toBe(0o550);
  expect(lstatSync(join(copied, "index.ts")).mode & 0o777).toBe(0o551);
});

test("cycles and unsupported entries fail without publishing new resources", async () => {
  const { driver, source, owner } = fixture();
  symlinkSync(source, join(source, "cycle"));
  await expect(capture(driver, source, owner)).rejects.toThrow(
    "contains a cycle",
  );
  rmSync(join(source, "cycle"));
  const fifo = join(source, "fifo");
  execFileSync("mkfifo", [fifo]);
  await expect(capture(driver, source, owner)).rejects.toThrow(
    "Unsupported package graph entry",
  );
  expect(readdirSync(join(owner, "side-quests", "resources"))).toHaveLength(0);
  rmSync(fifo);
  const copied = await capture(driver, source, owner);
  expect(await capture(driver, source, owner)).toBe(copied);
});

test("new copy protocol cannot reuse the legacy process pool or v2 index", async () => {
  const { source, owner } = fixture();
  const legacySymbol = Symbol.for("pi.side-quests.package-snapshots");
  const shared = process as unknown as Record<symbol, unknown>;
  const previous = shared[legacySymbol];
  shared[legacySymbol] = { get: () => Promise.resolve(source) };
  const oldIndex = join(owner, "side-quests", "snapshot-index", "v2");
  mkdirSync(oldIndex, { recursive: true });
  writeFileSync(
    join(oldIndex, "old-record.json"),
    "Legacy records stay intact",
  );
  try {
    const copied = await copyPackageSnapshot(source, owner, "package");
    expect(copied).not.toBe(source);
    writeFileSync(join(source, "support.txt"), "mutated source");
    expect(readFileSync(join(copied, "support.txt"), "utf8")).toBe("original");
    expect(readFileSync(join(oldIndex, "old-record.json"), "utf8")).toBe(
      "Legacy records stay intact",
    );
  } finally {
    if (previous === undefined) delete shared[legacySymbol];
    else shared[legacySymbol] = previous;
  }
});
