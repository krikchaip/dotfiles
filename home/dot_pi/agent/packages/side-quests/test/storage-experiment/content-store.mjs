// TEST-ONLY storage experiment. Not loaded by Side Quests.
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { isMainThread, parentPort, workerData } from "node:worker_threads";

const VERSION = "test-content-store-1";
const HEX = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

/**
 * Reads one record without treating corruption as absence.
 */
function record(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Writes complete metadata before atomically replacing its lookup record.
 */
function publish(path, value) {
  const pending = `${path}.${randomUUID()}.pending`;
  try {
    writeFileSync(pending, JSON.stringify(value), { flag: "wx", mode: 0o600 });
    renameSync(pending, path);
  } finally {
    rmSync(pending, { force: true });
  }
}

/**
 * Refuses real user storage and stores with unknown pre-existing ownership.
 */
function ownedStore(root) {
  const canonicalParent = realpathSync(dirname(root));
  const sandbox = realpathSync(tmpdir());
  if (canonicalParent !== sandbox && !canonicalParent.startsWith(`${sandbox}/`))
    throw new Error("Experiment storage must be inside test-owned TMPDIR");
  if (
    existsSync(root) &&
    (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink())
  )
    throw new Error("Unknown store ownership");
  mkdirSync(root, { recursive: true });
  return locked(root, () => {
    const marker = join(root, "store.json");
    if (!existsSync(marker)) {
      if (readdirSync(root).some((name) => name !== "lock"))
        throw new Error("Unknown store ownership");
      publish(marker, { version: VERSION, id: randomUUID() });
    }
    const info = record(marker);
    if (info.version !== VERSION || !UUID.test(info.id))
      throw new Error("Unknown store ownership");
    for (const name of ["objects", "graphs", "index", "leases", "refs"]) {
      const path = join(root, name);
      if (
        existsSync(path) &&
        (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())
      )
        throw new Error("Unknown store ownership");
      mkdirSync(path, { recursive: true });
    }
    return info;
  });
}

/**
 * Serializes publication and collection; an interrupted lock fails closed.
 */
function locked(root, run) {
  const lock = join(root, "lock");
  const end = Date.now() + 5000;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() > end) throw new Error("Store is busy or interrupted");
      Atomics.wait(sleeper, 0, 0, 10);
    }
  }
  try {
    return run();
  } finally {
    rmSync(lock, { recursive: true });
  }
}

/**
 * Detects source changes during a fixed-length read.
 */
function stamp(stat) {
  return [stat.ino, stat.size, stat.mode, stat.mtimeNs, stat.ctimeNs]
    .map(String)
    .join(":");
}

/**
 * Reads exactly the observed length; mutable growth cannot expand a copy.
 */
function readBytes(path, consume) {
  const fd = openSync(path, "r");
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error(`Unsupported source file ${path}`);
    const buffer = Buffer.alloc(64 * 1024);
    let position = 0;
    while (position < Number(before.size)) {
      const count = readSync(
        fd,
        buffer,
        0,
        Math.min(buffer.length, Number(before.size) - position),
        position,
      );
      if (!count) throw new Error(`Source shrank: ${path}`);
      consume(buffer.subarray(0, count));
      position += count;
    }
    if (stamp(before) !== stamp(fstatSync(fd, { bigint: true })))
      throw new Error(`Source changed: ${path}`);
    return { size: Number(before.size), mode: Number(before.mode) & 0o555 };
  } finally {
    closeSync(fd);
  }
}

/**
 * Describes content, not timestamps or installed paths; rejects link cycles.
 */
export function prepare(source) {
  const entries = [];
  const ancestors = new Set();
  const visit = (path) => {
    const before = statSync(path, { bigint: true });
    const name = relative(source, path);
    if (before.isDirectory()) {
      const canonical = realpathSync(path);
      if (ancestors.has(canonical))
        throw new Error("Dependency graph contains a cycle");
      ancestors.add(canonical);
      entries.push({
        name,
        type: "directory",
        mode: (Number(before.mode) & 0o777) | 0o700,
      });
      for (const child of readdirSync(path).sort()) visit(join(path, child));
      ancestors.delete(canonical);
    } else if (before.isFile()) {
      const hash = createHash("sha256");
      const details = readBytes(path, (bytes) => hash.update(bytes));
      entries.push({
        name,
        type: "file",
        ...details,
        object: `${hash.digest("hex")}-${details.mode.toString(8)}`,
      });
    } else throw new Error(`Unsupported graph entry ${path}`);
    if (stamp(before) !== stamp(statSync(path, { bigint: true })))
      throw new Error(`Source changed: ${path}`);
  };
  visit(source);
  return {
    entries,
    content: createHash("sha256").update(JSON.stringify(entries)).digest("hex"),
  };
}

/**
 * Registers a parent-process owner before returning any stored paths.
 */
function lease(root, info, graph, owner) {
  if (
    !UUID.test(owner.token) ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid < 1
  )
    throw new Error("Invalid process owner");
  publish(join(root, "leases", `${graph}-${owner.token}.json`), {
    store: info.id,
    graph,
    ...owner,
  });
}

/**
 * Captures a generation with immutable shared file bytes and native module paths.
 */
export function capture(source, root, owner, expected) {
  const plan = prepare(source);
  if (expected !== undefined && expected !== plan.content)
    throw new Error("Source changed since parent capture");
  const info = ownedStore(root);
  return locked(root, () => {
    const index = join(root, "index", `${plan.content}.json`);
    if (existsSync(index)) {
      const old = record(index);
      if (old.store !== info.id || !UUID.test(old.graph))
        throw new Error("Unknown index ownership");
      const path = join(root, "graphs", old.graph, "package");
      if (existsSync(path)) {
        lease(root, info, old.graph, owner);
        return { id: old.graph, content: plan.content, path };
      }
    }
    const objects = new Map(
      plan.entries.filter((e) => e.type === "file").map((e) => [e.object, e]),
    );
    const needed =
      [...objects].reduce(
        (bytes, [id, entry]) =>
          bytes +
          (existsSync(join(root, "objects", id))
            ? 0
            : Math.max(4096, Math.ceil(entry.size / 4096) * 4096)),
        0,
      ) +
      65536 +
      plan.entries.length * 4096;
    const disk = statfsSync(root);
    if (disk.bavail * disk.bsize - needed < 2 * 1024 ** 3)
      throw new Error("Insufficient free space after new content allocation");
    const graph = randomUUID();
    const stage = join(root, "graphs", `${graph}.pending`);
    const final = join(root, "graphs", graph);
    const created = [];
    mkdirSync(stage);
    try {
      for (const [id, entry] of objects) {
        const target = join(root, "objects", id);
        if (existsSync(target)) continue;
        const fd = openSync(target, "wx", 0o600);
        created.push(target);
        const hash = createHash("sha256");
        try {
          const details = readBytes(join(source, entry.name), (bytes) => {
            hash.update(bytes);
            let offset = 0;
            while (offset < bytes.length)
              offset += writeSync(fd, bytes, offset, bytes.length - offset);
          });
          if (`${hash.digest("hex")}-${details.mode.toString(8)}` !== id)
            throw new Error("Source changed during immutable capture");
        } finally {
          closeSync(fd);
        }
        chmodSync(target, entry.mode);
      }
      for (const entry of plan.entries) {
        const path = join(stage, "package", entry.name);
        if (entry.type === "directory")
          mkdirSync(path, { recursive: true, mode: entry.mode | 0o700 });
        else linkSync(join(root, "objects", entry.object), path);
      }
      if (prepare(source).content !== plan.content)
        throw new Error("Source changed during graph publication");
      publish(join(stage, "graph.json"), {
        version: VERSION,
        store: info.id,
        graph,
        ...plan,
      });
      renameSync(stage, final);
      lease(root, info, graph, owner);
      publish(index, { store: info.id, graph });
      return { id: graph, content: plan.content, path: join(final, "package") };
    } catch (error) {
      rmSync(stage, { recursive: true, force: true });
      // A complete graph with a lease is retained if lookup publication fails.
      if (!existsSync(join(root, "leases", `${graph}-${owner.token}.json`)))
        rmSync(final, { recursive: true, force: true });
      for (const path of created)
        if (existsSync(path) && lstatSync(path).nlink === 1) rmSync(path);
      throw error;
    }
  });
}

/**
 * Keeps the saved-session reference independently of the active process lease.
 */
export function pin(root, graph, session) {
  const info = ownedStore(root);
  if (!UUID.test(graph) || !UUID.test(session))
    throw new Error("Invalid saved owner");
  locked(root, () => {
    if (!existsSync(join(root, "graphs", graph, "graph.json")))
      throw new Error("Missing saved graph");
    const path = join(root, "refs", `${session}.json`);
    if (existsSync(path)) {
      const old = record(path);
      if (
        old.store !== info.id ||
        old.graph !== graph ||
        old.session !== session
      )
        throw new Error("Saved session generation is immutable");
      return;
    }
    publish(path, { store: info.id, graph, session });
  });
}

/**
 * Releases only a known process lease, not a saved-session reference.
 */
export function release(root, graph, owner) {
  if (!UUID.test(graph) || !UUID.test(owner.token))
    throw new Error("Invalid lease owner");
  const info = ownedStore(root);
  locked(root, () => {
    const path = join(root, "leases", `${graph}-${owner.token}.json`);
    const value = record(path);
    if (value.store !== info.id || value.pid !== owner.pid)
      throw new Error("Unknown lease ownership");
    rmSync(path);
  });
}

/**
 * Unknown records stop collection before any graph is deleted.
 */
export function collect(root) {
  const info = ownedStore(root);
  return locked(root, () => {
    const retained = new Set();
    const graphs = new Map();
    for (const file of readdirSync(join(root, "objects"))) {
      const path = join(root, "objects", file);
      const stat = lstatSync(path);
      if (
        !/^[a-f0-9]{64}-[0-7]{3}$/.test(file) ||
        !stat.isFile() ||
        stat.mode & 0o222
      )
        return { blocked: "Unknown object ownership", removed: [] };
      const hash = createHash("sha256");
      const details = readBytes(path, (bytes) => hash.update(bytes));
      if (`${hash.digest("hex")}-${details.mode.toString(8)}` !== file)
        return { blocked: "Unknown object ownership", removed: [] };
    }
    for (const file of readdirSync(join(root, "index"))) {
      let value;
      try {
        value = record(join(root, "index", file));
      } catch {
        return { blocked: "Unknown index ownership", removed: [] };
      }
      if (
        !/^[a-f0-9]{64}\.json$/.test(file) ||
        value.store !== info.id ||
        !UUID.test(value.graph)
      )
        return { blocked: "Unknown index ownership", removed: [] };
    }
    for (const id of readdirSync(join(root, "graphs"))) {
      if (
        !UUID.test(id) ||
        lstatSync(join(root, "graphs", id)).isSymbolicLink()
      )
        return { blocked: "Unknown graph ownership", removed: [] };
      let value;
      try {
        value = record(join(root, "graphs", id, "graph.json"));
      } catch {
        return { blocked: "Unknown graph ownership", removed: [] };
      }
      if (
        value.version !== VERSION ||
        value.store !== info.id ||
        value.graph !== id ||
        !HEX.test(value.content)
      )
        return { blocked: "Unknown graph ownership", removed: [] };
      graphs.set(id, value);
    }
    for (const kind of ["refs", "leases"]) {
      for (const file of readdirSync(join(root, kind))) {
        let value;
        if (!lstatSync(join(root, kind, file)).isFile())
          return { blocked: "Unknown reference ownership", removed: [] };
        try {
          value = record(join(root, kind, file));
        } catch {
          return { blocked: "Unknown reference ownership", removed: [] };
        }
        if (
          value.store !== info.id ||
          !UUID.test(value.graph) ||
          !graphs.has(value.graph)
        )
          return { blocked: "Unknown reference ownership", removed: [] };
        if (kind === "refs") {
          if (!UUID.test(value.session) || file !== `${value.session}.json`)
            return { blocked: "Unknown saved ownership", removed: [] };
          retained.add(value.graph);
          continue;
        }
        if (
          !UUID.test(value.token) ||
          !Number.isSafeInteger(value.pid) ||
          value.pid < 1 ||
          file !== `${value.graph}-${value.token}.json`
        )
          return { blocked: "Unknown lease ownership", removed: [] };
        try {
          process.kill(value.pid, 0);
          retained.add(value.graph);
        } catch (error) {
          if (error.code !== "ESRCH") retained.add(value.graph);
        }
      }
    }
    const removed = [];
    for (const id of graphs.keys()) {
      if (retained.has(id)) continue;
      rmSync(join(root, "graphs", id), { recursive: true });
      for (const file of readdirSync(join(root, "leases"))) {
        const path = join(root, "leases", file);
        if (record(path).graph === id) rmSync(path);
      }
      const index = join(root, "index", `${graphs.get(id).content}.json`);
      if (existsSync(index) && record(index).graph === id) rmSync(index);
      removed.push(id);
    }
    for (const file of readdirSync(join(root, "objects"))) {
      const path = join(root, "objects", file);
      if (
        !/^[a-f0-9]{64}-[0-7]{3}$/.test(file) ||
        lstatSync(path).isSymbolicLink()
      )
        continue;
      if (lstatSync(path).nlink === 1) rmSync(path);
    }
    return { removed };
  });
}

if (!isMainThread && workerData?.storageExperiment) {
  try {
    const { action, args } = workerData;
    const operations = { capture, prepare, collect, release, pin };
    parentPort.postMessage({ result: operations[action](...args) });
  } catch (error) {
    parentPort.postMessage({ error: error.message });
  }
}
