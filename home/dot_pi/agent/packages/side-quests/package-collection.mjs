import {
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";

export const SNAPSHOT_MARKER = ".package-snapshot.json";
export const OBJECT_ID = /^[a-f0-9]{64}-[0-7]{3}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const PUBLICATION_GRACE_MS = 60_000;

/**
 * Reads metadata without treating corruption as absence.
 */
export function readRecord(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Treats inaccessible and reused process IDs as potentially active owners.
 */
export function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1)
    throw new Error("Unknown process ownership");
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

/**
 * Validates the graph record before reuse, claiming, or collection.
 */
export function graphRecord(root, store) {
  const value = readRecord(join(root, SNAPSHOT_MARKER));
  if (
    value.version !== 3 ||
    value.store !== store ||
    !/^snapshot-[a-f0-9-]+$/.test(value.directory) ||
    !/^[a-f0-9]{64}$/.test(value.key) ||
    !["package", "node_modules"].includes(value.layout) ||
    !Array.isArray(value.entries) ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt < 0 ||
    !UUID.test(value.owner?.token) ||
    !Number.isSafeInteger(value.owner?.pid) ||
    value.owner.pid < 1
  )
    throw new Error("Unknown graph ownership");
  for (const entry of value.entries) {
    if (
      typeof entry.name !== "string" ||
      entry.name.startsWith("/") ||
      entry.name.split("/").includes("..") ||
      !["directory", "file"].includes(entry.type) ||
      !Number.isSafeInteger(entry.mode) ||
      entry.mode < 0 ||
      entry.mode > 0o555 ||
      entry.mode & 0o222 ||
      (entry.type === "file" &&
        (!OBJECT_ID.test(entry.object) ||
          !Number.isSafeInteger(entry.size) ||
          entry.size < 0))
    )
      throw new Error("Unknown graph entries");
  }
  return value;
}

/**
 * Finds all saved path references, including paths inside prompt records.
 */
export function graphReferences(value, resources, retained = new Set()) {
  if (typeof value === "string") {
    const prefix = `${resources}/`;
    let start = value.indexOf(prefix);
    while (start !== -1) {
      start += prefix.length;
      const match = /^snapshot-[a-f0-9-]+/.exec(value.slice(start));
      if (match) retained.add(match[0]);
      start = value.indexOf(prefix, start);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) graphReferences(item, resources, retained);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value))
      graphReferences(item, resources, retained);
  }
  return retained;
}

/**
 * Removes only an already-proven unused owned tree. Shared files stay read-only.
 */
export function removeOwnedTree(root) {
  if (!existsSync(root)) return;
  const visit = (path) => {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    chmodSync(path, (stat.mode & 0o777) | 0o700);
    for (const name of readdirSync(path)) visit(join(path, name));
  };
  visit(root);
  rmSync(root, { recursive: true, force: true });
}

/**
 * Collects only v3-owned unused graphs under the allocation lock.
 * Any unreadable or unknown saved/lease ownership prevents all deletion.
 * Legacy roots have no v3 ownership proof and are never changed.
 */
export function collectSnapshots(state, protectedObjects = new Set()) {
  const { resources, objects, leases, store, root } = state;
  const graphs = new Map();
  const stages = new Map();
  const retained = new Set();
  const knownObjects = new Set();
  try {
    for (const name of readdirSync(resources)) {
      const directory = join(resources, name);
      if (!existsSync(join(directory, SNAPSHOT_MARKER))) continue;
      if (
        !lstatSync(directory).isDirectory() ||
        lstatSync(directory).isSymbolicLink()
      )
        throw new Error("Unknown graph ownership");
      const value = graphRecord(directory, store);
      if (name === value.directory) graphs.set(name, value);
      else if (name === `pending-${value.directory.slice(9)}`)
        stages.set(name, value);
      else throw new Error("Unknown graph ownership");
      for (const entry of value.entries)
        if (entry.type === "file") knownObjects.add(entry.object);
    }
    for (const name of readdirSync(leases)) {
      const path = join(leases, name);
      if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())
        throw new Error("Unknown lease ownership");
      const value = readRecord(path);
      if (
        value.version !== 3 ||
        value.store !== store ||
        !UUID.test(value.token) ||
        name !== `${value.directory}-${value.token}.json` ||
        !/^snapshot-[a-f0-9-]+$/.test(value.directory)
      )
        throw new Error("Unknown lease ownership");
      if (alive(value.pid)) retained.add(value.directory);
    }
    const visit = (directory) => {
      if (!existsSync(directory)) return;
      const stat = lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("Unknown saved ownership");
      for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        const entry = lstatSync(path);
        if (entry.isSymbolicLink()) throw new Error("Unknown saved ownership");
        if (entry.isDirectory()) visit(path);
        else if (name === "manifest.json") {
          const manifest = readRecord(path);
          if (
            manifest.version !== 1 ||
            typeof manifest.sessionPath !== "string" ||
            typeof manifest.childId !== "string" ||
            typeof manifest.parentId !== "string"
          )
            throw new Error("Unknown saved ownership");
          graphReferences(manifest, resources, retained);
        }
      }
    };
    visit(join(root, "sessions"));
    // Validate all potentially collectible objects before the first deletion.
    for (const id of knownObjects) {
      const path = join(objects, id);
      if (!existsSync(path)) continue;
      const stat = lstatSync(path);
      if (
        !OBJECT_ID.test(id) ||
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.mode & 0o222
      )
        throw new Error("Unknown object ownership");
    }
  } catch (error) {
    return { removed: [], blocked: error.message };
  }
  const removed = [];
  for (const [name, value] of stages) {
    if (!alive(value.owner.pid)) {
      removeOwnedTree(join(resources, name));
      removed.push(name);
    }
  }
  for (const [name, value] of graphs) {
    if (
      !retained.has(name) &&
      Date.now() - value.createdAt >= PUBLICATION_GRACE_MS
    ) {
      removeOwnedTree(join(resources, name));
      removed.push(name);
    }
  }
  for (const name of readdirSync(leases)) {
    const path = join(leases, name);
    const value = readRecord(path);
    if (!alive(value.pid) && !graphs.has(value.directory)) rmSync(path);
    else if (removed.includes(value.directory)) rmSync(path);
  }
  for (const id of knownObjects) {
    const path = join(objects, id);
    if (
      !protectedObjects.has(id) &&
      existsSync(path) &&
      lstatSync(path).nlink === 1
    )
      rmSync(path);
  }
  return { removed };
}
