import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

const moduleURL = new URL("./content-store.mjs", import.meta.url);
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * Makes a small Package and dependency graph without any native installer.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "content-experiment-"));
  roots.push(root);
  const source = join(root, "installed");
  const store = join(root, "store");
  mkdirSync(join(source, "node_modules", "dependency"), { recursive: true });
  writeFileSync(join(source, "package.json"), '{"type":"module"}');
  writeFileSync(
    join(source, "index.js"),
    'import value from "./node_modules/dependency/index.js"; export default value;',
  );
  writeFileSync(
    join(source, "node_modules", "dependency", "index.js"),
    'export default "v1";',
  );
  writeFileSync(join(source, "unchanged"), Buffer.alloc(64 * 1024, 5));
  const owner = { pid: process.pid, token: randomUUID() };
  return { root, source, store, owner };
}

/**
 * Crosses the real off-thread storage seam and waits for worker teardown.
 */
function work(action, ...args) {
  return new Promise((done, failed) => {
    const worker = new Worker(moduleURL, {
      workerData: { storageExperiment: true, action, args },
      execArgv: [],
    });
    let response;
    worker.on("error", failed);
    worker.on("message", (message) => {
      response = message;
    });
    worker.on("exit", (code) => {
      if (code || !response || response.error)
        failed(new Error(response?.error ?? `Worker exited ${code}`));
      else done(response.result);
    });
  });
}

/**
 * Captures in an independent process with a real, short-lived process owner.
 */
function freshCapture(source, store) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
    import { randomUUID } from 'node:crypto';
    import { capture } from ${JSON.stringify(moduleURL.href)};
    console.log(JSON.stringify(capture(${JSON.stringify(source)}, ${JSON.stringify(store)}, {pid:process.pid, token:randomUUID()})));
  `,
      ],
      { encoding: "utf8" },
    ),
  );
}

/**
 * Measures retained bytes once per inode, so shared file links are not duplicated.
 */
function storedBytes(root) {
  const seen = new Set();
  let bytes = 0;
  const visit = (path) => {
    const stat = lstatSync(path);
    const key = `${stat.dev}:${stat.ino}`;
    if (stat.isDirectory())
      for (const name of readdirSync(path)) visit(join(path, name));
    else if (!seen.has(key)) {
      seen.add(key);
      bytes += stat.size;
    }
  };
  visit(root);
  return bytes;
}

test("100 sequential consumers keep one graph and one content set", async () => {
  const { source, store, owner } = fixture();
  const first = await work("capture", source, store, owner);
  const before = storedBytes(store);
  for (let n = 0; n < 100; n++)
    assert.equal(
      (await work("capture", source, store, owner)).path,
      first.path,
    );
  assert.equal(readdirSync(join(store, "graphs")).length, 1);
  assert.equal(storedBytes(store), before);
  console.log(`100 consumers: ${before} retained bytes; 0 bytes growth`);
});

test("independent processes and concurrent publishers reuse the same generation", async () => {
  const { source, store, owner } = fixture();
  const first = freshCapture(source, store);
  assert.equal(freshCapture(source, store).path, first.path);
  const results = await Promise.all(
    Array.from({ length: 4 }, () => work("capture", source, store, owner)),
  );
  assert.ok(results.every((result) => result.path === first.path));
  assert.equal(readdirSync(join(store, "graphs")).length, 1);
});

test("metadata-only changes do not allocate another graph", async () => {
  const { source, store, owner } = fixture();
  const first = await work("capture", source, store, owner);
  const future = new Date(Date.now() + 60000);
  utimesSync(join(source, "unchanged"), future, future);
  assert.equal((await work("capture", source, store, owner)).path, first.path);
});

test("a changed version shares unchanged bytes and preserves dependency resolution", async () => {
  const { source, store, owner } = fixture();
  const first = await work("capture", source, store, owner);
  const before = storedBytes(store);
  writeFileSync(
    join(source, "node_modules", "dependency", "index.js"),
    'export default "v2";',
  );
  const second = await work("capture", source, store, owner);
  assert.notEqual(second.path, first.path);
  assert.equal(
    lstatSync(join(first.path, "unchanged")).ino,
    lstatSync(join(second.path, "unchanged")).ino,
  );
  assert.notEqual(
    lstatSync(join(first.path, "unchanged")).ino,
    lstatSync(join(source, "unchanged")).ino,
  );
  assert.equal(
    (await import(pathToFileURL(join(first.path, "index.js")).href)).default,
    "v1",
  );
  assert.equal(
    (await import(pathToFileURL(join(second.path, "index.js")).href)).default,
    "v2",
  );
  const growth = storedBytes(store) - before;
  assert.ok(growth < 8192, `Changed version added ${growth} bytes`);
  console.log(
    `Changed version: ${growth} extra bytes; 64 KiB dependency payload shared`,
  );
});

test("shared content is read-only instead of shared writable installed files", async () => {
  const { source, store, owner } = fixture();
  const snapshot = await work("capture", source, store, owner);
  const file = join(snapshot.path, "unchanged");
  assert.equal(lstatSync(file).mode & 0o222, 0);
  if (process.getuid?.() !== 0)
    assert.throws(() => writeFileSync(file, "overwrite"), { code: "EACCES" });
  writeFileSync(join(source, "unchanged"), "changed installed bytes");
  assert.equal(readFileSync(file).length, 64 * 1024);
});

test("parent preparation creates no stored graph and rejects changed provenance", async () => {
  const { source, store, owner } = fixture();
  const prepared = await work("prepare", source);
  assert.equal(existsSync(store), false);
  writeFileSync(join(source, "unchanged"), "changed");
  await assert.rejects(
    work("capture", source, store, owner, prepared.content),
    /changed since parent capture/,
  );
  assert.equal(existsSync(store), false);
});

test("saved and active owners survive collection; only released unreferenced content is removed", async () => {
  const { source, store, owner } = fixture();
  const first = await work("capture", source, store, owner);
  assert.deepEqual((await work("collect", store)).removed, []);
  await work("pin", store, first.id, randomUUID());
  await work("release", store, first.id, owner);
  writeFileSync(
    join(source, "node_modules", "dependency", "index.js"),
    'export default "v2";',
  );
  const second = await work("capture", source, store, owner);
  assert.deepEqual((await work("collect", store)).removed, []);
  await work("release", store, second.id, owner);
  assert.deepEqual((await work("collect", store)).removed, [second.id]);
  assert.equal(existsSync(first.path), true);
  assert.equal(existsSync(second.path), false);
  assert.equal(
    (await import(pathToFileURL(join(first.path, "index.js")).href)).default,
    "v1",
  );
  assert.equal(readdirSync(join(store, "objects")).length, 4);
});

test("unknown references and unknown graph ownership prevent all deletion", async () => {
  const { source, store, owner } = fixture();
  const graph = await work("capture", source, store, owner);
  await work("release", store, graph.id, owner);
  const unknown = join(store, "refs", "unreadable.json");
  writeFileSync(unknown, "broken metadata");
  assert.match((await work("collect", store)).blocked, /Unknown reference/);
  assert.equal(existsSync(graph.path), true);
  rmSync(unknown);
  mkdirSync(join(store, "graphs", "legacy-root"));
  assert.match((await work("collect", store)).blocked, /Unknown graph/);
  assert.equal(existsSync(graph.path), true);
});

test("cold concurrent publishers retain one graph", async () => {
  const { source, store, owner } = fixture();
  const results = await Promise.all(
    Array.from({ length: 6 }, () => work("capture", source, store, owner)),
  );
  assert.equal(new Set(results.map((result) => result.path)).size, 1);
  assert.equal(readdirSync(join(store, "graphs")).length, 1);
});

test("unknown object or index metadata prevents deletion before collection starts", async () => {
  const { source, store, owner } = fixture();
  const graph = await work("capture", source, store, owner);
  await work("release", store, graph.id, owner);
  const unknown = join(store, "objects", "foreign-data");
  writeFileSync(unknown, "do not delete");
  assert.match((await work("collect", store)).blocked, /Unknown object/);
  assert.equal(existsSync(graph.path), true);
  rmSync(unknown);
  writeFileSync(join(store, "index", "unknown.json"), "broken metadata");
  assert.match((await work("collect", store)).blocked, /Unknown index/);
  assert.equal(existsSync(graph.path), true);
});

test("saved owners cannot silently change their original generation", async () => {
  const { source, store, owner } = fixture();
  const first = await work("capture", source, store, owner);
  const session = randomUUID();
  await work("pin", store, first.id, session);
  writeFileSync(join(source, "unchanged"), "changed");
  const second = await work("capture", source, store, owner);
  await assert.rejects(
    work("pin", store, second.id, session),
    /generation is immutable/,
  );
});

test("dead process leases can release unreferenced content", async () => {
  const { source, store } = fixture();
  const graph = freshCapture(source, store);
  assert.deepEqual((await work("collect", store)).removed, [graph.id]);
  assert.equal(existsSync(graph.path), false);
  assert.equal(readdirSync(join(store, "objects")).length, 0);
});

test("a symlink cannot redirect the test store into another directory", async () => {
  const { source, store, owner } = fixture();
  symlinkSync(source, store);
  await assert.rejects(
    work("capture", source, store, owner),
    /Unknown store ownership/,
  );
  assert.equal(readFileSync(join(source, "unchanged")).length, 64 * 1024);
  assert.equal(existsSync(join(source, "store.json")), false);
});

test("cycles fail without creating storage", async () => {
  const { source, store, owner } = fixture();
  symlinkSync(source, join(source, "cycle"));
  await assert.rejects(
    work("capture", source, store, owner),
    /contains a cycle/,
  );
  assert.equal(existsSync(store), false);
});
