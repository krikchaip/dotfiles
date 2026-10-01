import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
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
  writeFileSync,
  writeSync,
} from "node:fs";
import { join, relative } from "node:path";
import { reserveContent } from "./package-budget.mjs";
import {
  OBJECT_ID,
  SNAPSHOT_MARKER,
  collectSnapshots,
  graphRecord,
  readRecord,
  removeOwnedTree,
} from "./package-collection.mjs";

const HEX = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

/**
 * Flushes complete publication metadata before another process can use it.
 */
function publish(path, value) {
  const pending = `${path}.${randomUUID()}.pending`;
  const fd = openSync(pending, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(pending, path);
  } finally {
    rmSync(pending, { force: true });
  }
}

/**
 * Opens only the owned v3 pool, leaving legacy resource layouts unchanged.
 */
export function storageState(agentDirectory) {
  const root = join(agentDirectory, "side-quests");
  const resources = join(root, "resources");
  const index = join(root, "snapshot-index", "v3");
  const objects = join(root, "snapshot-objects", "v3");
  const aliases = join(root, "snapshot-aliases", "v3");
  const leases = join(root, "snapshot-leases", "v3");
  for (const path of [resources, index, objects, aliases, leases]) {
    if (
      existsSync(path) &&
      (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())
    )
      throw new Error("Unknown snapshot store ownership");
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  const marker = join(objects, "store.json");
  if (!existsSync(marker)) {
    if (readdirSync(objects).length !== 0)
      throw new Error("Unknown object store ownership");
    publish(marker, { version: 3, id: randomUUID() });
  }
  const info = readRecord(marker);
  if (info.version !== 3 || !UUID.test(info.id))
    throw new Error("Unknown object store ownership");
  return { root, resources, index, objects, aliases, leases, store: info.id };
}

/**
 * Reads exactly the observed source length and rejects concurrent changes.
 */
function readBytes(path, consume) {
  const input = openSync(path, "r");
  try {
    const before = fstatSync(input, { bigint: true });
    if (!before.isFile() || before.size > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error(`Unsupported package graph entry ${path}`);
    const buffer = Buffer.alloc(64 * 1024);
    let position = 0;
    while (position < Number(before.size)) {
      const count = readSync(
        input,
        buffer,
        0,
        Math.min(buffer.length, Number(before.size) - position),
        position,
      );
      if (!count) throw new Error(`Package graph entry shrank: ${path}`);
      consume(buffer.subarray(0, count));
      position += count;
    }
    const after = fstatSync(input, { bigint: true });
    if (
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mode !== after.mode ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    )
      throw new Error(`Package graph changed during content capture: ${path}`);
    const mode = (Number(before.mode) & 0o555) | 0o400;
    return { size: Number(before.size), mode };
  } finally {
    closeSync(input);
  }
}

/**
 * Keys content by relative names, read-only modes, and bytes, not installed paths.
 */
function prepare(source, layout) {
  const entries = [];
  const ancestors = new Set();
  const visit = (path) => {
    const stat = statSync(path);
    const name = relative(source, path);
    if (stat.isDirectory()) {
      const canonical = realpathSync(path);
      if (ancestors.has(canonical))
        throw new Error(`Package dependency graph contains a cycle at ${path}`);
      ancestors.add(canonical);
      entries.push({
        name,
        type: "directory",
        mode: (stat.mode & 0o555) | 0o500,
      });
      for (const child of readdirSync(path).sort()) visit(join(path, child));
      ancestors.delete(canonical);
    } else if (stat.isFile()) {
      const hash = createHash("sha256");
      const details = readBytes(path, (bytes) => hash.update(bytes));
      entries.push({
        name,
        type: "file",
        ...details,
        object: `${hash.digest("hex")}-${details.mode.toString(8).padStart(3, "0")}`,
      });
    } else throw new Error(`Unsupported package graph entry ${path}`);
  };
  visit(source);
  if (entries[0]?.type !== "directory")
    throw new Error("Package graph source must be a directory");
  const identity = JSON.stringify([3, layout, entries]);
  return {
    entries,
    identity,
    key: createHash("sha256").update(identity).digest("hex"),
  };
}

/**
 * Registers the consuming process before its stored paths become visible.
 */
export function claimGraph(state, directory, owner) {
  if (
    !UUID.test(owner.token) ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid < 1
  )
    throw new Error("Invalid snapshot process owner");
  const path = join(state.leases, `${directory}-${owner.token}.json`);
  if (existsSync(path)) {
    const old = readRecord(path);
    if (
      old.version !== 3 ||
      old.store !== state.store ||
      old.directory !== directory ||
      old.pid !== owner.pid ||
      old.token !== owner.token
    )
      throw new Error("Unknown snapshot lease ownership");
    return;
  }
  publish(path, { version: 3, store: state.store, directory, ...owner });
}

/**
 * Follows immutable repair records when an owned test or collected graph is absent.
 */
function lookup(state, key, identity, layout) {
  let recordPath = join(state.index, `${key}.json`);
  const seen = new Set();
  for (;;) {
    if (!existsSync(recordPath)) return { recordPath };
    const value = readRecord(recordPath);
    if (
      value.version !== 3 ||
      value.store !== state.store ||
      value.identity !== identity ||
      typeof value.directory !== "string" ||
      !/^snapshot-[a-f0-9-]+$/.test(value.directory) ||
      seen.has(value.directory)
    )
      throw new Error(`Invalid package snapshot index ${recordPath}`);
    seen.add(value.directory);
    const directory = join(state.resources, value.directory);
    const destination = join(directory, layout);
    if (existsSync(directory)) {
      if (
        lstatSync(directory).isSymbolicLink() ||
        !lstatSync(destination).isDirectory() ||
        lstatSync(destination).isSymbolicLink()
      )
        throw new Error(`Invalid package snapshot directory ${destination}`);
      const marker = graphRecord(directory, state.store);
      if (
        marker.directory !== value.directory ||
        marker.key !== key ||
        marker.layout !== layout
      )
        throw new Error(`Invalid package snapshot directory ${destination}`);
      return { recordPath, destination, directory: value.directory };
    }
    recordPath = join(state.index, `${key}-${value.directory}.json`);
  }
}

/**
 * Reuses a verified object or publishes a sealed copy, never an installed-file link.
 */
function object(state, source, entry, stage) {
  if (!OBJECT_ID.test(entry.object)) throw new Error("Invalid content object");
  const target = join(state.objects, entry.object);
  if (existsSync(target)) {
    const stat = lstatSync(target);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size !== entry.size ||
      (stat.mode & 0o777) !== entry.mode
    )
      throw new Error("Invalid stored content object");
    return target;
  }
  const pending = join(stage, `${entry.object}.pending`);
  const output = openSync(pending, "wx", 0o600);
  try {
    const hash = createHash("sha256");
    const details = readBytes(join(source, entry.name), (bytes) => {
      hash.update(bytes);
      let written = 0;
      while (written < bytes.length)
        written += writeSync(output, bytes, written, bytes.length - written);
    });
    if (
      `${hash.digest("hex")}-${details.mode.toString(8).padStart(3, "0")}` !==
      entry.object
    )
      throw new Error("Package graph changed during content publication");
    chmodSync(pending, entry.mode);
    fsyncSync(output);
  } finally {
    closeSync(output);
  }
  linkSync(pending, target);
  rmSync(pending);
  return target;
}

/**
 * Captures one native-resolution view while sharing unchanged immutable file bytes.
 * All calls, including warm claims and collection, hold the allocation lock.
 */
export function captureContent(
  source,
  before,
  agentDirectory,
  layout,
  owner,
  fingerprint,
  pending,
) {
  if (!["package", "node_modules"].includes(layout))
    throw new Error(`Invalid package snapshot layout: ${layout}`);
  const state = storageState(agentDirectory);
  const aliasPath = join(
    state.aliases,
    `${createHash("sha256")
      .update(JSON.stringify([source, layout]))
      .digest("hex")}.json`,
  );
  if (existsSync(aliasPath)) {
    const alias = readRecord(aliasPath);
    if (
      alias.version !== 3 ||
      alias.store !== state.store ||
      alias.source !== source ||
      alias.layout !== layout ||
      !HEX.test(alias.key) ||
      typeof alias.identity !== "string"
    )
      throw new Error("Invalid package snapshot alias");
    if (alias.before === before) {
      const found = lookup(state, alias.key, alias.identity, layout);
      if (found.destination) {
        if (fingerprint(source) !== before)
          throw new Error(`Package graph changed while copying ${source}`);
        claimGraph(state, found.directory, owner);
        collectSnapshots(state);
        return found.destination;
      }
    }
  }
  const plan = prepare(source, layout);
  if (fingerprint(source) !== before)
    throw new Error(`Package graph changed while copying ${source}`);
  const found = lookup(state, plan.key, plan.identity, layout);
  if (found.destination) {
    claimGraph(state, found.directory, owner);
    publish(aliasPath, {
      version: 3,
      store: state.store,
      source,
      layout,
      before,
      key: plan.key,
      identity: plan.identity,
    });
    collectSnapshots(state);
    return found.destination;
  }
  const unique = new Map(
    plan.entries
      .filter((entry) => entry.type === "file")
      .map((entry) => [entry.object, entry]),
  );
  collectSnapshots(state, new Set(unique.keys()));
  const required =
    [...unique].reduce(
      (bytes, [id, entry]) =>
        bytes +
        (existsSync(join(state.objects, id))
          ? 0
          : Math.max(4096, Math.ceil(entry.size / 4096) * 4096)),
      0,
    ) +
    plan.entries.length * 4096;
  reserveContent(agentDirectory, required);
  const directory = `snapshot-${randomUUID()}`;
  const stage = join(state.resources, `pending-${directory.slice(9)}`);
  const final = join(state.resources, directory);
  const marker = {
    version: 3,
    store: state.store,
    directory,
    key: plan.key,
    layout,
    entries: plan.entries,
    owner,
    createdAt: Date.now(),
  };
  mkdirSync(stage, { mode: 0o700 });
  publish(join(stage, SNAPSHOT_MARKER), marker);
  pending(stage);
  let published = false;
  try {
    for (const entry of plan.entries) {
      const path = join(stage, layout, entry.name);
      if (entry.type === "directory")
        mkdirSync(path, { recursive: true, mode: 0o700 });
      else linkSync(object(state, source, entry, stage), path);
    }
    if (fingerprint(source) !== before)
      throw new Error(`Package graph changed while copying ${source}`);
    chmodSync(join(stage, SNAPSHOT_MARKER), 0o400);
    for (const entry of [...plan.entries].reverse())
      if (entry.type === "directory")
        chmodSync(join(stage, layout, entry.name), entry.mode);
    chmodSync(stage, 0o500);
    renameSync(stage, final);
    claimGraph(state, directory, owner);
    publish(found.recordPath, {
      version: 3,
      store: state.store,
      identity: plan.identity,
      directory,
    });
    published = true;
    publish(aliasPath, {
      version: 3,
      store: state.store,
      source,
      layout,
      before,
      key: plan.key,
      identity: plan.identity,
    });
    return join(final, layout);
  } finally {
    removeOwnedTree(stage);
    if (!published) {
      removeOwnedTree(final);
      const lease = join(state.leases, `${directory}-${owner.token}.json`);
      rmSync(lease, { force: true });
      for (const id of unique.keys()) {
        const path = join(state.objects, id);
        if (existsSync(path) && lstatSync(path).nlink === 1) rmSync(path);
      }
    }
  }
}
