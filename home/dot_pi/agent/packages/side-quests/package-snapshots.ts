import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

/**
 * Shares completed graph generations across Pi's replacement module contexts.
 */
const SNAPSHOTS = Symbol.for("pi.side-quests.package-snapshots.v3");
const SNAPSHOT_OWNER = Symbol.for("pi.side-quests.package-snapshot-owner.v3");

/**
 * Keeps graph promises shared without retaining an extension runtime or API.
 */
type SnapshotProcess = typeof process & {
  /** Keys immutable graph copies by storage owner, source, layout, and fingerprint. */
  [SNAPSHOTS]?: Map<string, Promise<string>>;

  /** Identifies this live Pi process across replacement module contexts. */
  [SNAPSHOT_OWNER]?: Readonly<{ pid: number; token: string }>;
};

/**
 * Describes the native worker's fingerprint and completion messages.
 */
type CopyMessage =
  | { type: "fingerprint"; source: string; fingerprint: string }
  | { type: "pending"; directory: string }
  | { type: "complete"; destination?: string }
  | { type: "error"; error: string };

/**
 * Copies a graph off-thread and reuses a completed identical parent generation.
 */
export function copyPackageSnapshot(
  source: string,
  agentDirectory: string,
  layout: "node_modules" | "package",
  expectedFingerprint?: string,
): Promise<string> {
  const shared = process as SnapshotProcess;
  shared[SNAPSHOTS] ??= new Map<string, Promise<string>>();
  const snapshots = shared[SNAPSHOTS];
  return new Promise((resolve, reject) => {
    const worker = createWorker(source, processOwner(shared));
    let directory: string | undefined;
    let key: string | undefined;
    let pending: Promise<string> | undefined;
    let resolveCopy: ((path: string) => void) | undefined;
    let rejectCopy: ((cause: Error) => void) | undefined;
    let settled = false;

    const fail = async (cause: Error) => {
      if (settled) return;
      settled = true;
      if (key && snapshots.get(key) === pending) snapshots.delete(key);
      let failure = cause;
      try {
        await worker.terminate();
        if (directory) await removePending(directory);
      } catch (cleanup) {
        failure = new Error(
          `${cause.message}; snapshot cleanup failed: ${String(cleanup)}`,
        );
      }
      rejectCopy?.(failure);
      reject(failure);
    };
    worker.on(
      "error",
      (cause) =>
        void fail(cause instanceof Error ? cause : new Error(String(cause))),
    );
    worker.on("exit", () => {
      if (!settled)
        void fail(
          new Error(`Package snapshot worker exited before copying ${source}`),
        );
    });
    worker.on("message", (message: CopyMessage) => {
      if (message.type === "error") {
        void fail(new Error(`Package snapshot ${source}: ${message.error}`));
      } else if (message.type === "pending") {
        // Only a new unpublished staging root is eligible for owner cleanup.
        directory = message.directory;
      } else if (message.type === "complete") {
        settled = true;
        resolveCopy?.(message.destination as string);
        resolve(message.destination as string);
      } else {
        if (
          expectedFingerprint !== undefined &&
          message.fingerprint !== expectedFingerprint
        ) {
          void fail(
            new Error(
              `Package ${source} changed since parent capture; reload before launching a child`,
            ),
          );
          return;
        }
        key = JSON.stringify([
          3,
          agentDirectory,
          message.source,
          layout,
          message.fingerprint,
        ]);
        startCopy();
      }
    });

    const startCopy = () => {
      const existing = snapshots.get(key as string);
      if (existing) {
        void existing.then(
          (path) => {
            if (existsSync(path)) {
              settled = true;
              void worker.terminate();
              resolve(path);
            } else {
              if (snapshots.get(key as string) === existing)
                snapshots.delete(key as string);
              startCopy();
            }
          },
          (cause: Error) => void fail(cause),
        );
        return;
      }
      try {
        pending = new Promise<string>((done, failed) => {
          resolveCopy = done;
          rejectCopy = failed;
        });
        // A background capture can fail before a child consumes its promise.
        void pending.catch(() => {});
        snapshots.set(key as string, pending);
        worker.postMessage({ agentDirectory, layout });
      } catch (cause) {
        void fail(cause instanceof Error ? cause : new Error(String(cause)));
      }
    };
  });
}

/**
 * Records provenance off-thread without allocating a graph until a child needs it.
 */
export function preparePackageSnapshot(
  source: string,
  agentDirectory: string,
  layout: "node_modules" | "package",
): Promise<() => Promise<string>> {
  return new Promise((resolve, reject) => {
    const worker = createWorker(
      source,
      processOwner(process as SnapshotProcess),
    );
    let settled = false;
    worker.on("error", reject);
    worker.on("exit", () => {
      if (!settled)
        reject(new Error(`Package capture worker exited for ${source}`));
    });
    worker.on("message", (message: CopyMessage) => {
      settled = true;
      void worker.terminate();
      if (message.type !== "fingerprint") {
        reject(
          new Error(
            `Package capture ${source}: ${message.type === "error" ? message.error : "unexpected response"}`,
          ),
        );
        return;
      }
      let snapshot: Promise<string> | undefined;
      resolve(() => {
        snapshot ??= copyPackageSnapshot(
          message.source,
          agentDirectory,
          layout,
          message.fingerprint,
        ).catch((cause) => {
          snapshot = undefined;
          throw cause;
        });
        return snapshot;
      });
    });
  });
}

/**
 * Returns one live owner identity shared by all Side Quests module generations.
 */
function processOwner(shared: SnapshotProcess) {
  shared[SNAPSHOT_OWNER] ??= { pid: process.pid, token: randomUUID() };
  return shared[SNAPSHOT_OWNER];
}

/**
 * Removes only an unpublished worker directory after making directories writable.
 */
async function removePending(path: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      await chmod(path, (stat.mode & 0o777) | 0o700);
      for (const name of await readdir(path))
        await removePending(join(path, name));
    }
    await rm(path, { recursive: true, force: true });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }
}

/**
 * Starts native JavaScript work without inheriting a TypeScript loader or CLI flags.
 */
function createWorker(
  source: string,
  owner: Readonly<{ pid: number; token: string }>,
): Worker {
  return new Worker(new URL("./package-snapshot.mjs", import.meta.url), {
    workerData: { source, owner },
    execArgv: [],
  });
}
