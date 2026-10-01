import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { RuntimeStore } from "../store/runtime.ts";
import { type ChildManifest, SessionStore } from "../store/session.ts";

/**
 * Shares registration names across Pi's native and transformed module contexts.
 */
const CHILD_TOOLS = Symbol.for("pi.side-quests.child-extension-tools");

/**
 * Keeps pre-allowlist registration names local to one managed child process.
 */
type ChildToolProcess = typeof process & {
  /** Stores registration names under their managed parent and child identities. */
  [CHILD_TOOLS]?: Map<string, Set<string>>;
};

/**
 * Consumes extension tool names without widening the child execution allowlist.
 */
export function takeChildExtensionTools(
  identity: Pick<ChildManifest, "parentId" | "childId">,
): readonly string[] {
  const key = JSON.stringify([identity.parentId, identity.childId]);
  const registry = (process as ChildToolProcess)[CHILD_TOOLS];
  const names = [...(registry?.get(key) ?? [])];
  registry?.delete(key);
  return names;
}

/**
 * Creates one private native-Pi wrapper for each immutable selected entrypoint.
 */
export async function createChildExtensionEntrypoints(
  manifest: ChildManifest,
): Promise<readonly string[]> {
  const hostPath = fileURLToPath(import.meta.url);
  const identity = {
    parentId: manifest.parentId,
    childId: manifest.childId,
  };

  return Promise.all(
    (manifest.extensionPaths ?? []).map((path, index) =>
      SessionStore.writeExtensionEntrypoint(
        manifest,
        index,
        [
          `import { initializeChildExtension } from ${JSON.stringify(hostPath)};`,
          "export default async function (pi) {",
          `  await initializeChildExtension(pi, ${JSON.stringify(path)}, ${JSON.stringify(identity)});`,
          "}",
          "",
        ].join("\n"),
      ),
    ),
  );
}

/**
 * Imports and initializes one selection in Pi's native module and API context.
 * Failed startup exits only this managed child before any prompt can execute.
 */
export async function initializeChildExtension(
  pi: ExtensionAPI,
  path: string,
  identity: Pick<ChildManifest, "parentId" | "childId">,
): Promise<void> {
  let phase = "import";
  try {
    // Pi's native TypeScript importer retains its bundled aliases here.
    const module = await import(path);
    phase = "export";
    if (typeof module.default !== "function")
      throw new Error("Extension does not export a valid factory function.");
    phase = "factory";
    const key = JSON.stringify([identity.parentId, identity.childId]);
    const shared = process as ChildToolProcess;
    shared[CHILD_TOOLS] ??= new Map();
    const registry = shared[CHILD_TOOLS];
    const names = registry.get(key) ?? new Set<string>();
    registry.set(key, names);
    const observed = new Proxy(pi, {
      get(target, property, receiver) {
        if (property !== "registerTool")
          return Reflect.get(target, property, receiver);
        return (tool: Parameters<ExtensionAPI["registerTool"]>[0]) => {
          target.registerTool(tool);
          names.add(tool.name);
        };
      },
    });
    await module.default(observed);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    try {
      RuntimeStore.writeReadiness(identity.parentId, {
        childId: identity.childId,
        status: "failed",
        createdAt: Date.now(),
        error: `${path}: Failed to load extension (${phase}): ${reason}`,
      });
    } finally {
      // Pi normally catches extension factory errors and continues startup.
      // Exit even if readiness persistence fails; partial startup is unsafe.
      process.exit(1);
    }
  }
}
