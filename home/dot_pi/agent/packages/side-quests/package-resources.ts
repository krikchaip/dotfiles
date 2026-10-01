import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  DefaultPackageManager,
  type PackageSource,
  type SettingsManager,
  type SourceInfo,
} from "@earendil-works/pi-coding-agent";

import { reserveContent } from "./package-budget.mjs";
import {
  copyPackageSnapshot,
  preparePackageSnapshot,
} from "./package-snapshots.ts";

const COMMAND_FAILURE_TAIL_BYTES = 16 * 1024;

/**
 * Names the native resource scope used for resolution and warm-cache lookup.
 */
type Scope = SourceInfo["scope"];

/**
 * Carries one native settings source with its original scope.
 */
type PackageEntry = Readonly<{ pkg: PackageSource; scope: Scope }>;

/**
 * Describes only the native parser fields used by the storage adapter.
 */
type ParsedSource =
  | { type: "local"; path: string }
  | { type: "npm"; name: string; pinned: boolean }
  | { type: "git"; ref?: string; pinned: boolean };

/**
 * Isolates the Pi 0.85.1 package methods needed for durable resource storage.
 */
type NativePackageManager = {
  parseSource(source: string): ParsedSource;
  getBaseDirForScope(scope: Scope): string;
  getNpmInstallPath(source: ParsedSource, scope: Scope): string;
  getGitInstallPath(source: ParsedSource, scope: Scope): string;
  getLegacyGlobalNpmInstallPath(source: unknown): string | undefined;
  installedNpmMatchesConfiguredVersion(
    source: ParsedSource,
    path: string,
  ): Promise<boolean>;
  findAutoloadDeltaBase(
    pkg: PackageSource,
    scope: Scope,
    sources: readonly PackageEntry[],
  ): { source: string; scope: Scope } | undefined;
  createAccumulator(): unknown;
  runCommand(
    command: string,
    args: string[],
    options?: { cwd?: string },
  ): Promise<void>;
  runCommandCapture(
    command: string,
    args: string[],
    options?: { cwd?: string },
  ): Promise<string>;
  installParsedSource(source: ParsedSource, scope: Scope): Promise<void>;
  resolvePackageSources(
    sources: readonly PackageEntry[],
    accumulator: unknown,
    onMissing?: (source: string) => Promise<"install" | "skip" | "error">,
  ): Promise<void>;
};

/**
 * Keeps native package discovery private and freezes loaded files with their dependencies.
 */
export class PiPackageResources {
  private readonly copiedRoots = new Map<string, Promise<string>>();
  private readonly preparedRoots = new Map<
    string,
    Promise<() => Promise<string>>
  >();

  /**
   * Installs one storage policy on an owned native package manager.
   */
  constructor(
    private readonly manager: DefaultPackageManager,
    settingsManager: SettingsManager,
    private readonly agentDirectory: string,
  ) {
    const native = manager as unknown as NativePackageManager;
    const captureCommand = native.runCommandCapture.bind(manager);
    native.runCommand = async (command, args, options) => {
      try {
        await captureCommand(command, args, options);
      } catch (cause) {
        throw quietCommandFailure(cause);
      }
    };
    const original = native.resolvePackageSources.bind(manager);
    native.resolvePackageSources = async (sources, accumulator, onMissing) => {
      if (
        !sources.some(
          ({ pkg }) => native.parseSource(sourceString(pkg)).type !== "local",
        )
      )
        return original(sources, accumulator, onMissing);
      const offline = ["1", "true", "yes"].includes(
        process.env.PI_OFFLINE?.toLowerCase() ?? "",
      );
      const entries = sources.map(({ pkg, scope }) => {
        const delta = native.findAutoloadDeltaBase(pkg, scope, sources);
        const source = delta?.source ?? sourceString(pkg);
        return {
          parsed: native.parseSource(source),
          scope,
          resolvedScope: delta?.scope ?? scope,
          source,
        };
      });
      let needsInstall = false;
      for (const entry of entries) {
        if (entry.parsed.type === "local") continue;
        if (
          !(await this.findInstalled(
            entry.parsed,
            entry.resolvedScope,
            native,
            offline,
          ))
        )
          needsInstall = true;
      }
      const missingActions = new Map<string, "install" | "skip" | "error">();
      if (needsInstall) {
        if (offline)
          throw new Error(
            "Offline Package selection has no matching installed resources",
          );
        // Native installation is proportional to the selected Package graph. The
        // free-space floor protects its start and completion; immutable capture
        // then accounts only distinct content in the Side Quests store.
        reserveContent(this.agentDirectory, 0, 0);
        await original(
          sources,
          native.createAccumulator(),
          onMissing
            ? async (source) => {
                const action = await onMissing(source);
                missingActions.set(source, action);
                return action;
              }
            : undefined,
        );
        // Pi resolves an existing pinned Git checkout without reconciling a new
        // ref. Reuse its native installer to fetch and reset that checkout.
        for (const entry of entries) {
          if (
            entry.parsed.type !== "git" ||
            !entry.parsed.ref ||
            (await this.findInstalled(
              entry.parsed,
              entry.resolvedScope,
              native,
              true,
            ))
          )
            continue;
          const installed = native.getGitInstallPath(
            entry.parsed,
            entry.resolvedScope,
          );
          if (!existsSync(installed)) continue;
          const action =
            missingActions.get(entry.source) ??
            (onMissing ? await onMissing(entry.source) : "install");
          missingActions.set(entry.source, action);
          if (action === "skip") continue;
          if (action === "error")
            throw new Error(`Missing source: ${entry.source}`);
          await native.installParsedSource(entry.parsed, entry.resolvedScope);
        }
        reserveContent(this.agentDirectory, 0, 0);
      }
      const warm = new Map<string, string>();
      const graphs = new Map<string, Promise<string>>();
      for (const entry of entries) {
        if (entry.parsed.type === "local") continue;
        const installed = await this.findInstalled(
          entry.parsed,
          entry.resolvedScope,
          native,
          true,
        );
        if (!installed) {
          if (missingActions.get(entry.source) === "skip") continue;
          throw new Error(
            `Package ${entry.source} has no matching installed resources after installation`,
          );
        }
        // Fresh discovery fingerprints current installs. The separate freeze()
        // memo retains the original parent-loaded generation intentionally.
        const root =
          entry.parsed.type === "npm"
            ? npmDependencyRoot(installed)
            : installed;
        let graph = graphs.get(root);
        if (!graph) {
          graph = copyPackageSnapshot(
            root,
            this.agentDirectory,
            entry.parsed.type === "npm" ? "node_modules" : "package",
          );
          graphs.set(root, graph);
        }
        const frozen = join(await graph, relative(root, installed));
        // Refuse a source-version change between lookup and immutable capture.
        if (
          entry.parsed.type === "npm" &&
          !(await native.installedNpmMatchesConfiguredVersion(
            entry.parsed,
            frozen,
          ))
        )
          throw new Error(
            `Package ${entry.source} changed during warm capture`,
          );
        warm.set(packageKey(entry.parsed, entry.resolvedScope), frozen);
      }
      const isolated = new DefaultPackageManager({
        agentDir: this.agentDirectory,
        cwd: this.agentDirectory,
        settingsManager,
      }) as unknown as NativePackageManager;
      const npmPath = isolated.getNpmInstallPath.bind(isolated);
      const gitPath = isolated.getGitInstallPath.bind(isolated);
      isolated.getNpmInstallPath = (parsed, scope) =>
        warm.get(packageKey(parsed, scope)) ?? npmPath(parsed, scope);
      isolated.getGitInstallPath = (parsed, scope) =>
        warm.get(packageKey(parsed, scope)) ?? gitPath(parsed, scope);
      // Local settings retain their scope. Remote resources resolve only through
      // the immutable paths captured above; no second install or refresh can run.
      isolated.getBaseDirForScope = native.getBaseDirForScope.bind(manager);
      isolated.getLegacyGlobalNpmInstallPath = () => undefined;
      isolated.runCommandCapture = async () => "";
      isolated.runCommand = async () => {};
      await isolated.resolvePackageSources(
        sources,
        accumulator,
        onMissing
          ? async (source) =>
              missingActions.get(source) ?? (await onMissing(source))
          : undefined,
      );
    };
  }

  /**
   * Pins loaded graph provenance without copying files during parent startup.
   */
  async prepareFreeze(
    path: string,
    sourceInfo: SourceInfo,
  ): Promise<() => Promise<string>> {
    if (sourceInfo.origin !== "package") return async () => path;
    const parsed = (
      this.manager as unknown as NativePackageManager
    ).parseSource(sourceInfo.source);
    if (parsed.type === "local") return async () => path;
    if (!sourceInfo.baseDir)
      throw new Error(`Package resource ${path} has no native package root`);
    const root =
      parsed.type === "npm"
        ? npmDependencyRoot(sourceInfo.baseDir)
        : sourceInfo.baseDir;
    const suffix = relative(root, path);
    if (suffix === ".." || suffix.startsWith(`..${sep}`))
      throw new Error(`Package resource ${path} is outside ${root}`);
    let prepared = this.preparedRoots.get(root);
    if (!prepared) {
      prepared = preparePackageSnapshot(
        root,
        this.agentDirectory,
        parsed.type === "npm" ? "node_modules" : "package",
      );
      this.preparedRoots.set(root, prepared);
    }
    const materialize = await prepared;
    return async () => join(await materialize(), suffix);
  }

  /**
   * Copies remote package content once, with supporting files and npm dependencies.
   */
  async freeze(path: string, sourceInfo: SourceInfo): Promise<string> {
    if (sourceInfo.origin !== "package") return path;
    const native = this.manager as unknown as NativePackageManager;
    const parsed = native.parseSource(sourceInfo.source);
    if (parsed.type === "local") return path;
    if (!sourceInfo.baseDir)
      throw new Error(`Package resource ${path} has no native package root`);
    const root =
      parsed.type === "npm"
        ? npmDependencyRoot(sourceInfo.baseDir)
        : sourceInfo.baseDir;
    const suffix = relative(root, path);
    if (suffix === ".." || suffix.startsWith(`..${sep}`))
      throw new Error(`Package resource ${path} is outside ${root}`);
    let copied = this.copiedRoots.get(root);
    if (!copied) {
      copied = copyPackageSnapshot(
        root,
        this.agentDirectory,
        parsed.type === "npm" ? "node_modules" : "package",
      );
      this.copiedRoots.set(root, copied);
      void copied.catch(() => this.copiedRoots.delete(root));
    }
    return join(await copied, suffix);
  }

  /**
   * Finds a matching warm install without changing it or refreshing mutable refs.
   */
  private async findInstalled(
    parsed: Exclude<ParsedSource, { type: "local" }>,
    scope: Scope,
    native: NativePackageManager,
    offline: boolean,
  ): Promise<string | undefined> {
    // Explicit online unpinned additions require a fresh native installation.
    if (scope === "temporary" && !parsed.pinned && !offline) return;
    const scopes: Scope[] =
      scope === "temporary" ? ["project", "user", "temporary"] : [scope];
    for (const candidateScope of scopes) {
      const candidate =
        parsed.type === "npm"
          ? native.getNpmInstallPath(parsed, candidateScope)
          : native.getGitInstallPath(parsed, candidateScope);
      if (!existsSync(candidate)) continue;
      if (
        parsed.type === "npm" &&
        !(await native.installedNpmMatchesConfiguredVersion(parsed, candidate))
      )
        continue;
      if (parsed.type === "git" && parsed.ref) {
        try {
          const head = await native.runCommandCapture(
            "git",
            ["rev-parse", "HEAD"],
            { cwd: candidate },
          );
          const ref = await native.runCommandCapture(
            "git",
            ["rev-parse", `${parsed.ref}^{commit}`],
            { cwd: candidate },
          );
          if (head.trim() !== ref.trim()) continue;
        } catch {
          continue;
        }
      }
      return candidate;
    }
  }
}

/**
 * Keeps successful Package commands silent and bounds failed command diagnostics.
 */
function quietCommandFailure(cause: unknown): Error {
  const message = cause instanceof Error ? cause.message : String(cause);
  const bytes = Buffer.from(message);
  if (bytes.length <= COMMAND_FAILURE_TAIL_BYTES) return new Error(message);
  const omitted = bytes.length - COMMAND_FAILURE_TAIL_BYTES;
  const tail = bytes.subarray(omitted).toString("utf8");
  return new Error(`[${omitted} earlier bytes omitted]\n${tail}`);
}

/**
 * Keys the full native parsed selector and scope, including exact versions/refs.
 */
function packageKey(parsed: ParsedSource, scope: Scope): string {
  return JSON.stringify([parsed, scope]);
}

/**
 * Reads the native string or filtered-object source without changing its syntax.
 */
function sourceString(pkg: PackageSource): string {
  return typeof pkg === "string" ? pkg : pkg.source;
}

/**
 * Keeps the node_modules graph rather than only the selected package directory.
 */
function npmDependencyRoot(packageDirectory: string): string {
  const marker = `${sep}node_modules${sep}`;
  const index = packageDirectory.indexOf(marker);
  if (index < 0)
    throw new Error(`npm resource ${packageDirectory} has no dependency root`);
  return packageDirectory.slice(0, index + marker.length - 1);
}
