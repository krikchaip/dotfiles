import {
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { threadId } from "node:worker_threads";

const FREE_FLOOR = 2 * 1024 * 1024 * 1024;
const BLOCK_BYTES = 4096;
export const PUBLICATION_BYTES = 64 * 1024;

/**
 * Uses no default size cap. Operators and isolated tests can set an explicit bound.
 */
export function resourceBudget() {
  const configured = process.env.PI_SIDE_QUESTS_MAX_RESOURCE_BYTES;
  if (configured === undefined) return Number.POSITIVE_INFINITY;
  const bytes = Number(configured);
  if (!Number.isSafeInteger(bytes) || bytes <= 0)
    throw new Error(
      "Invalid Side Quests resource budget: use a positive safe integer",
    );
  return bytes;
}

/**
 * Charges each entry conservatively, without relying on shared clone blocks.
 */
export function entryBytes(stat) {
  return Math.max(
    BLOCK_BYTES,
    Math.ceil(stat.size / BLOCK_BYTES) * BLOCK_BYTES,
    stat.blocks * 512,
  );
}

/**
 * Measures stored resources or a dereferenced source graph, stopping at the cap.
 */
export function treeBytes(
  root,
  limit,
  dereference = false,
  inodes = new Set(),
) {
  const ancestors = new Set();
  let bytes = 0;
  const visit = (path) => {
    const stat = dereference ? statSync(path) : lstatSync(path);
    const inode = `${stat.dev}:${stat.ino}`;
    if (!inodes.has(inode)) {
      inodes.add(inode);
      bytes += entryBytes(stat);
    }
    if (bytes > limit)
      throw new Error(
        `Side Quests resource budget exceeded while measuring ${root}`,
      );
    if (!stat.isDirectory()) return;
    const canonical = realpathSync(path);
    if (ancestors.has(canonical))
      throw new Error(`Package dependency graph contains a cycle at ${path}`);
    ancestors.add(canonical);
    for (const name of readdirSync(path)) visit(join(path, name));
    ancestors.delete(canonical);
  };
  try {
    visit(root);
  } catch (cause) {
    // An absent root is empty; missing descendants are not silently ignored.
    if (cause.code === "ENOENT" && bytes === 0) return 0;
    throw cause;
  }
  return bytes;
}

/**
 * Serializes allocation across processes. A crashed owner fails closed on timeout.
 * Never guesses that another process's lock or saved resources can be deleted.
 */
export function withResourceAllocation(agentDirectory, run) {
  const root = join(agentDirectory, "side-quests");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const lock = join(root, "resource-allocation.lock");
  const deadline = Date.now() + 10_000;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      mkdirSync(lock, { mode: 0o700 });
      break;
    } catch (cause) {
      if (cause.code !== "EEXIST") throw cause;
      if (Date.now() >= deadline)
        throw new Error(
          `Side Quests resource allocation is busy or interrupted: ${lock}; no copy was started`,
        );
      Atomics.wait(sleeper, 0, 0, 25);
    }
  }
  try {
    writeFileSync(
      join(lock, "owner.json"),
      JSON.stringify({ pid: process.pid, threadId }),
      { flag: "wx", mode: 0o600 },
    );
    return run();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/**
 * Reserves only new content and metadata, without charging shared file bytes twice.
 * Callers hold the allocation lock until publication or failure cleanup ends.
 */
export function reserveContent(
  agentDirectory,
  required,
  metadata = PUBLICATION_BYTES,
) {
  const root = join(agentDirectory, "side-quests");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const limit = resourceBudget();
  let used = 0;
  if (Number.isFinite(limit)) {
    const inodes = new Set();
    for (const name of [
      "resources",
      "snapshot-index",
      "snapshot-objects",
      "snapshot-leases",
      "snapshot-aliases",
    ]) {
      used += treeBytes(join(root, name), limit, false, inodes);
    }
  }
  if (used + required + metadata > limit)
    throw new Error(
      `Side Quests resource budget exceeded: ${used} stored + ${required} new content + ${metadata} metadata > ${limit} bytes; no copy was started`,
    );
  const disk = statfsSync(root);
  const free = disk.bavail * disk.bsize;
  if (free - required - metadata < FREE_FLOOR)
    throw new Error(
      "Side Quests resource budget requires 2 GiB free after new content allocation; no copy was started",
    );
  return required;
}
