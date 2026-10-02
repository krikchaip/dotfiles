import { existsSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import {
  DefaultPackageManager,
  DefaultResourceLoader,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import type { ConfiguredCapability } from "./agent-definitions.ts";
import type { CapabilityEntry } from "./capability-selection.ts";
import {
  type ExtensionIntegrity,
  captureExtensionIntegrity,
} from "./extension-integrity.ts";
import { PiPackageResources } from "./package-resources.ts";

/**
 * Records one immutable Pi-resolved extension entrypoint and its source identity.
 */
export type ResolvedExtension = Readonly<{
  /** Identifies the exact extension entrypoint that a child must load. */
  path: string;

  /** Identifies the loaded parent entrypoint that supplied capabilities. */
  providerPath: string;

  /** Lists tools registered by this exact loaded parent entrypoint. */
  providedTools: readonly string[];

  /** Preserves the exact source spelling, including an npm version or Git ref. */
  source: string;

  /** Identifies the Pi-normalized package or local-path identity. */
  identity: string;

  /** Distinguishes direct discovery from a selected package resource. */
  origin: "direct" | "package";

  /** Records source bytes and exact installed Package provenance. */
  integrity?: ExtensionIntegrity;
}>;

/**
 * Hides Pi resource discovery and source resolution behind one testable boundary.
 */
export type ExtensionDiscovery = Readonly<{
  /** Discovers the currently enabled, non-temporary Pi extension set. */
  normal(): Promise<readonly ResolvedExtension[]>;

  /** Discovers the current Direct baseline without resolving settings packages. */
  direct(): Promise<readonly ResolvedExtension[]>;

  /** Resolves explicit sources from one Agent-definition field directory. */
  explicit(
    sources: readonly string[],
    baseDirectory: string,
  ): Promise<readonly ResolvedExtension[]>;
}>;

/**
 * Resolves one Agent extension selection with Pi's package and path semantics.
 */
export class ExtensionSelection {
  /** Creates the selection policy around one Pi discovery adapter. */
  constructor(private readonly discovery: ExtensionDiscovery) {}

  /**
   * Resolves a configured selection against an immutable parent extension snapshot.
   */
  async resolve(
    configured: ConfiguredCapability | undefined,
    parentSnapshot: readonly ResolvedExtension[],
  ): Promise<readonly ResolvedExtension[]> {
    if (!configured) return immutable(parentSnapshot);

    const { selection } = configured;
    if (selection.kind === "all")
      return immutable(await this.discovery.normal());

    if (selection.kind === "none")
      return immutable(await this.discovery.direct());

    if (selection.kind === "fixed") {
      const direct = await this.discovery.direct();
      const selected = await this.resolveEntries(
        selection.entries,
        configured.sourcePath,
        parentSnapshot,
      );
      return immutable(replaceByIdentity(direct, selected));
    }

    const resolvedEntries = await Promise.all(
      selection.entries.map(async (entry) => ({
        entry,
        resolved: await this.resolveEntries(
          [entry],
          configured.sourcePath,
          parentSnapshot,
        ),
      })),
    );
    this.validateOperations(resolvedEntries);

    const result = [...parentSnapshot];
    for (const { entry, resolved } of resolvedEntries) {
      if (entry.kind === "include") {
        result.splice(0, result.length, ...replaceByIdentity(result, resolved));
        continue;
      }
      const identities = new Set(resolved.map(({ identity }) => identity));
      const paths = new Set(
        resolved.map(({ path }) => physicalEntrypoint(path)),
      );
      // A manifest-backed local directory has a package identity, but the same
      // loaded Direct entrypoints have file identities. Match only its resolved
      // surface; do not expand removal to undeclared siblings or other packages.
      const next = result.filter(
        ({ identity, origin, path }) =>
          !identities.has(identity) &&
          (origin !== "direct" || !paths.has(physicalEntrypoint(path))),
      );
      if (next.length === result.length)
        throw new Error(
          `Extension ${entry.name} does not match the parent set`,
        );
      result.splice(0, result.length, ...next);
    }

    return immutable(result);
  }

  /** Resolves explicit selected sources and rejects empty Pi resource results. */
  private async resolveEntries(
    entries: readonly CapabilityEntry[],
    sourcePath: string,
    parentSnapshot: readonly ResolvedExtension[],
  ): Promise<readonly ResolvedExtension[]> {
    const selected: ResolvedExtension[] = [];
    const operations = new Map<string, CapabilityEntry>();
    for (const entry of entries) {
      const inherited = parentSnapshot.filter(
        ({ source }) => source === entry.name,
      );
      const resolved = inherited.length
        ? inherited
        : await this.discovery.explicit(
            [entry.name],
            definitionScope(sourcePath),
          );
      if (!resolved.length)
        throw new Error(
          `Extension ${entry.name} did not resolve to an extension entrypoint`,
        );

      for (const { identity } of resolved) {
        const previous = operations.get(identity);
        if (previous && previous.name !== entry.name)
          throw new Error(
            previous.kind === entry.kind
              ? `Extension selection repeats Pi identity ${identity}`
              : `Extension selection conflicts on Pi identity ${identity}`,
          );
        operations.set(identity, entry);
      }
      selected.push(...resolved);
    }
    return selected;
  }

  /** Rejects conflicting extension operations after Pi has normalized identity. */
  private validateOperations(
    entries: readonly Readonly<{
      entry: CapabilityEntry;
      resolved: readonly ResolvedExtension[];
    }>[],
  ): void {
    const operations = new Map<string, CapabilityEntry>();
    for (const { entry, resolved } of entries)
      for (const { identity } of resolved) {
        const previous = operations.get(identity);
        if (previous && previous.name !== entry.name)
          throw new Error(
            previous.kind === entry.kind
              ? `Extension selection repeats Pi identity ${identity}`
              : `Extension selection conflicts on Pi identity ${identity}`,
          );
        operations.set(identity, entry);
      }
  }
}

/**
 * Creates the production adapter around Pi's public package resolver.
 */
export function createPiExtensionDiscovery(options: {
  agentDirectory: string;
  cwd: string;
}): ExtensionDiscovery {
  const settingsManager = SettingsManager.create(
    options.cwd,
    options.agentDirectory,
  );
  const manager = new DefaultPackageManager({
    agentDir: options.agentDirectory,
    cwd: options.cwd,
    settingsManager,
  });
  new PiPackageResources(
    manager,
    settingsManager,
    options.agentDirectory,
    false,
  );

  return {
    normal: async () => {
      await settingsManager.reload();
      return asExtensions(manager, await manager.resolve(), (metadata, path) =>
        packageIdentity(
          manager,
          metadata.origin === "package" ? metadata.source : path,
          metadata.scope,
        ),
      );
    },
    direct: async () => {
      await settingsManager.reload();
      // Keep native scoped paths, filters, and auto-discovery. Remove only the
      // package batch in an owned read-only settings view, never on disk.
      const directSettings = SettingsManager.fromStorage(
        {
          withLock(scope, read) {
            const settings =
              scope === "global"
                ? settingsManager.getGlobalSettings()
                : settingsManager.getProjectSettings();
            read(JSON.stringify({ ...settings, packages: [] }));
          },
        },
        { projectTrusted: settingsManager.isProjectTrusted() },
      );
      const directManager = new DefaultPackageManager({
        agentDir: options.agentDirectory,
        cwd: options.cwd,
        settingsManager: directSettings,
      });
      return asExtensions(
        directManager,
        await directManager.resolve(),
        (metadata, path) =>
          packageIdentity(directManager, path, metadata.scope),
      );
    },
    explicit: async (sources, baseDirectory) => {
      await settingsManager.reload();
      const selected: ResolvedExtension[] = [];
      for (const source of sources) {
        const scoped = localSource(manager, source, baseDirectory);
        const resources = await manager.resolveExtensionSources([scoped], {
          temporary: true,
        });
        const expanded = expandLocalExtensions(manager, scoped, resources);
        selected.push(
          ...(await asExtensions(manager, expanded, (metadata) =>
            packageIdentity(manager, metadata.source, metadata.scope),
          )),
        );
      }
      return selected;
    },
  };
}

/**
 * Captures Pi's actual loaded parent entrypoints, without rediscovery or factory execution.
 * Pi 0.85.1 reads the loader after extension registration. Restore the getter on capture.
 */
export function capturePiParentExtensions(options: {
  agentDirectory: string;
  cwd: string;
}): () => Promise<readonly ResolvedExtension[]> {
  const settingsManager = SettingsManager.create(
    options.cwd,
    options.agentDirectory,
  );
  const manager = new DefaultPackageManager({
    agentDir: options.agentDirectory,
    cwd: options.cwd,
    settingsManager,
  });
  const ownPaths = new Set([
    new URL("./index.ts", import.meta.url).pathname,
    new URL("./child/index.ts", import.meta.url).pathname,
  ]);
  const original = DefaultResourceLoader.prototype.getExtensions;
  let snapshot: Promise<readonly ResolvedExtension[]> | undefined;
  DefaultResourceLoader.prototype.getExtensions = function () {
    const result = original.call(this);
    if (
      result.extensions.some(({ resolvedPath }) => ownPaths.has(resolvedPath))
    ) {
      DefaultResourceLoader.prototype.getExtensions = original;
      snapshot = Promise.all(
        result.extensions
          .filter(
            ({ resolvedPath }) =>
              !ownPaths.has(resolvedPath) &&
              !resolvedPath.startsWith("<inline:"),
          )
          .map(async ({ resolvedPath, sourceInfo, tools }) => ({
            integrity: await captureExtensionIntegrity(
              resolvedPath,
              sourceInfo,
              manager,
            ),
            identity: packageIdentity(
              manager,
              sourceInfo.origin === "package"
                ? sourceInfo.source
                : resolvedPath,
              sourceInfo.scope,
            ),
            origin:
              sourceInfo.origin === "package"
                ? ("package" as const)
                : ("direct" as const),
            path: resolvedPath,
            providerPath: resolvedPath,
            providedTools: Object.freeze([...tools.keys()]),
            source:
              sourceInfo.origin === "package"
                ? sourceInfo.source
                : resolvedPath,
          })),
      ).then(immutable);
      // Defer diagnostics to the Agent call, without an unhandled startup rejection.
      void snapshot.catch(() => {});
    }
    return result;
  };
  return async () => {
    if (!snapshot)
      throw new Error(
        "Pi 0.85.1 loaded parent extension snapshot is unavailable",
      );
    return snapshot;
  };
}

type PiMetadata = Readonly<{
  source: string;
  scope: "user" | "project" | "temporary";
  origin: "package" | "top-level";
  baseDir?: string;
}>;

type PiResolvedResource = Readonly<{
  path: string;
  enabled: boolean;
  metadata: PiMetadata;
}>;

type PiResolvedPaths = Readonly<{ extensions: readonly PiResolvedResource[] }>;

/** Converts Pi's resolved resource records to the child manifest representation. */
async function asExtensions(
  manager: DefaultPackageManager,
  paths: PiResolvedPaths,
  identity: (metadata: PiMetadata, path: string) => string,
): Promise<readonly ResolvedExtension[]> {
  return Promise.all(
    paths.extensions
      .filter(({ enabled }) => enabled)
      .map(async ({ metadata, path }) => ({
        integrity: await captureExtensionIntegrity(
          path,
          { ...metadata, path },
          manager,
        ),
        identity: identity(metadata, path),
        origin:
          metadata.origin === "package"
            ? ("package" as const)
            : ("direct" as const),
        path,
        providerPath: path,
        providedTools: Object.freeze([]),
        source: metadata.origin === "package" ? metadata.source : path,
      })),
  );
}

/**
 * Returns the global agent directory or project .pi directory for one field.
 */
function definitionScope(sourcePath: string): string {
  return dirname(dirname(sourcePath));
}

/**
 * Resolves only Pi local-path source forms against the supplying definition scope.
 */
function localSource(
  manager: DefaultPackageManager,
  source: string,
  baseDirectory: string,
): string {
  const native = manager as unknown as PiResourceMethods;
  const parsed = native.parseSource(source);
  return parsed.type === "local"
    ? native.resolvePathFromBase(parsed.path, baseDirectory)
    : source;
}

/**
 * Isolates Pi 0.85.1's native parser and discovery methods behind one contract.
 */
type PiResourceMethods = {
  parseSource(
    source: string,
  ): { type: "local"; path: string } | { type: "npm" | "git" };
  resolvePathFromBase(source: string, baseDirectory: string): string;
  collectFilesFromManifestEntries(
    entries: string[],
    root: string,
    type: "extensions",
  ): string[];
  collectFilesFromPaths(paths: string[], type: "extensions"): string[];
  getBaseDirForScope(scope: PiMetadata["scope"]): string;
};

/**
 * Uses Pi's glob and directory expansion without executing extension factories.
 */
function expandLocalExtensions(
  manager: DefaultPackageManager,
  source: string,
  resources: PiResolvedPaths,
): PiResolvedPaths {
  const native = manager as unknown as PiResourceMethods;
  if (native.parseSource(source).type !== "local") return resources;
  if (!existsSync(source)) {
    return {
      extensions: native
        .collectFilesFromManifestEntries(
          [source],
          dirname(source),
          "extensions",
        )
        .map((path) => ({
          path,
          enabled: true,
          metadata: { source: path, scope: "temporary", origin: "top-level" },
        })),
    };
  }
  return {
    extensions: resources.extensions.flatMap((resource) =>
      native
        .collectFilesFromPaths([resource.path], "extensions")
        .map((path) => ({
          ...resource,
          path,
          // Native fallback directories expand to Direct entrypoints, not packages.
          metadata:
            path === resource.path
              ? resource.metadata
              : {
                  ...resource.metadata,
                  source: path,
                  origin: "top-level" as const,
                },
        })),
    ),
  };
}

/**
 * Calls Pi's package identity implementation without reproducing its parser.
 */
function packageIdentity(
  manager: DefaultPackageManager,
  source: string,
  scope: PiMetadata["scope"],
): string {
  const native = manager as unknown as PiResourceMethods;
  const parsed = native.parseSource(source);
  let identitySource = source;
  if (parsed.type === "local") {
    const resolved = native.resolvePathFromBase(
      parsed.path,
      native.getBaseDirForScope(scope),
    );
    // Use the same filesystem canonicalization as Pi's resolved-resource dedupe.
    // Missing selectors retain their native path so strict no-match errors remain.
    try {
      identitySource = realpathSync(resolved);
    } catch {
      identitySource = resolved;
    }
  }
  const identityManager = manager as unknown as {
    getPackageIdentity(source: string, scope: PiMetadata["scope"]): string;
  };
  return identityManager.getPackageIdentity(identitySource, scope);
}

/** Replaces all entries of each selected identity while preserving source order. */
function replaceByIdentity(
  base: readonly ResolvedExtension[],
  replacements: readonly ResolvedExtension[],
): readonly ResolvedExtension[] {
  const replacementIdentities = new Set(
    replacements.map(({ identity }) => identity),
  );
  return [
    ...base.filter(({ identity }) => !replacementIdentities.has(identity)),
    ...replacements,
  ];
}

/**
 * Canonicalizes an entrypoint without hiding missing-file readiness failures.
 */
function physicalEntrypoint(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Freezes the outward collection so manifests retain an exact resolved snapshot.
 */
function immutable(
  extensions: readonly ResolvedExtension[],
): readonly ResolvedExtension[] {
  const paths = new Set<string>();
  return Object.freeze(
    extensions.filter(({ path }) => {
      const canonical = physicalEntrypoint(path);
      if (paths.has(canonical)) return false;
      paths.add(canonical);
      return true;
    }),
  );
}
