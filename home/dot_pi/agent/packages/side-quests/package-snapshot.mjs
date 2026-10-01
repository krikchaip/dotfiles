import { createHash, randomUUID } from "node:crypto";
import {
  lstatSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import { join, relative } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { withResourceAllocation } from "./package-budget.mjs";
import {
  SNAPSHOT_MARKER,
  graphRecord,
  graphReferences,
} from "./package-collection.mjs";
import {
  captureContent,
  claimGraph,
  storageState,
} from "./package-content.mjs";

/**
 * Fingerprints every dereferenced graph member without reading package contents.
 * ctime and inode changes detect replacements even when a version stays the same.
 */
function fingerprint(root) {
  const hash = createHash("sha256");
  const ancestors = new Set();
  const visit = (path) => {
    const link = lstatSync(path, { bigint: true });
    const target = link.isSymbolicLink()
      ? statSync(path, { bigint: true })
      : link;
    hash.update(
      JSON.stringify([
        relative(root, path),
        link.isSymbolicLink() ? readlinkSync(path) : "",
        String(link.ino),
        String(link.ctimeNs),
        String(link.mtimeNs),
        String(target.ino),
        String(target.mode),
        String(target.size),
        String(target.ctimeNs),
        String(target.mtimeNs),
      ]),
    );
    if (!target.isDirectory()) return;
    const canonical = realpathSync(path);
    if (ancestors.has(canonical))
      throw new Error(`Package dependency graph contains a cycle at ${path}`);
    ancestors.add(canonical);
    for (const name of readdirSync(path).sort()) visit(join(path, name));
    ancestors.delete(canonical);
  };
  visit(root);
  return hash.digest("hex");
}

/**
 * Reports failures after the content store cleans this worker's unpublished files.
 */
function fail(cause) {
  parentPort.postMessage({
    type: "error",
    error: cause instanceof Error ? cause.message : String(cause),
  });
  parentPort.close();
}

try {
  const owner = workerData.owner ?? { pid: process.pid, token: randomUUID() };
  if (workerData.action === "claim") {
    const agentDirectory = realpathSync(workerData.agentDirectory);
    const resources = join(agentDirectory, "side-quests", "resources");
    const directories = graphReferences(workerData.manifest, resources);
    withResourceAllocation(agentDirectory, () => {
      for (const directory of directories) {
        const path = join(resources, directory);
        // Legacy copies have no v3 ownership marker and are never collected.
        try {
          lstatSync(join(path, SNAPSHOT_MARKER));
        } catch (error) {
          if (error.code === "ENOENT") continue;
          throw error;
        }
        const state = storageState(agentDirectory);
        const marker = graphRecord(path, state.store);
        if (marker.directory !== directory)
          throw new Error("Unknown graph ownership");
        claimGraph(state, directory, owner);
      }
    });
    parentPort.postMessage({ type: "complete" });
    parentPort.close();
  } else {
    const source = realpathSync(workerData.source);
    if (workerData.destination)
      throw new Error("Unbudgeted Package tree copies are disabled");
    const before = fingerprint(source);
    parentPort.postMessage({
      type: "fingerprint",
      source,
      fingerprint: before,
    });
    parentPort.once("message", ({ agentDirectory, layout }) => {
      try {
        const destination = withResourceAllocation(agentDirectory, () =>
          captureContent(
            source,
            before,
            agentDirectory,
            layout,
            owner,
            fingerprint,
            (directory) =>
              parentPort.postMessage({ type: "pending", directory }),
          ),
        );
        parentPort.postMessage({ type: "complete", destination });
        parentPort.close();
      } catch (cause) {
        fail(cause);
      }
    });
  }
} catch (cause) {
  fail(cause);
}
