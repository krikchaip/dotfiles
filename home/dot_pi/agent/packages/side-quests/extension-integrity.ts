import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  DefaultPackageManager,
  SourceInfo,
} from "@earendil-works/pi-coding-agent";

const execute = promisify(execFile);

/**
 * Records small source checks without copying a Package graph.
 */
export type ExtensionIntegrity = Readonly<{
  /** Records the exact resolved entrypoint. */
  path: string;

  /** Records the entrypoint content hash. */
  digest: string;

  /** Records exact remote Package provenance when present. */
  package?: Readonly<{
    root: string;
    exactSource: string;
    manifestDigest?: string;
    commit?: string;
    temporary: boolean;
  }>;
}>;

/**
 * Captures loaded bytes and the installed Package version or Git commit.
 */
export async function captureExtensionIntegrity(
  path: string,
  source: SourceInfo,
  manager: DefaultPackageManager,
): Promise<ExtensionIntegrity> {
  const digest = await hashFile(path);
  if (source.origin !== "package") return { path, digest };
  const native = manager as unknown as {
    parseSource(
      source: string,
    ):
      | { type: "local" }
      | { type: "npm"; name: string }
      | { type: "git"; repo: string };
    getNpmInstallPath(source: unknown, scope: "temporary"): string;
    getGitInstallPath(source: unknown, scope: "temporary"): string;
  };
  const parsed = native.parseSource(source.source);
  if (parsed.type === "local") return { path, digest };
  const root = source.baseDir;
  if (!root) throw new Error(`Extension Package root is missing: ${path}`);
  let manifestDigest: string | undefined;
  try {
    manifestDigest = await hashFile(join(root, "package.json"));
  } catch (cause) {
    if (parsed.type === "npm" || !missing(cause)) throw cause;
  }
  let exactSource: string;
  let commit: string | undefined;
  if (parsed.type === "npm") {
    const manifest = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    );
    if (
      typeof manifest.version !== "string" ||
      !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(manifest.version)
    )
      throw new Error(`Extension Package has no exact version: ${path}`);
    exactSource = `npm:${parsed.name}@${manifest.version}`;
  } else {
    commit = await gitCommit(root);
    exactSource = `git:${parsed.repo}@${commit}`;
  }
  return {
    path,
    digest,
    package: {
      root,
      exactSource,
      manifestDigest,
      commit,
      temporary:
        source.scope === "temporary" &&
        root ===
          (parsed.type === "npm"
            ? native.getNpmInstallPath(parsed, "temporary")
            : native.getGitInstallPath(parsed, "temporary")),
    },
  };
}

/**
 * Refuses changed sources and recovers only missing native temporary Packages.
 */
export async function validateExtensionIntegrity(
  records: readonly ExtensionIntegrity[],
  recover: (source: string, path: string, root: string) => Promise<void>,
): Promise<void> {
  for (const record of records) {
    let recovered = false;
    while (true) {
      try {
        if ((await hashFile(record.path)) !== record.digest)
          throw new Error(`Saved extension changed: ${record.path}`);
        const pkg = record.package;
        if (pkg) {
          if (
            pkg.manifestDigest &&
            (await hashFile(join(pkg.root, "package.json"))) !==
              pkg.manifestDigest
          )
            throw new Error(
              `Saved extension Package changed: ${record.path} (${pkg.exactSource})`,
            );
          if (pkg.commit && (await gitCommit(pkg.root)) !== pkg.commit)
            throw new Error(
              `Saved extension Package changed: ${record.path} (${pkg.exactSource})`,
            );
        }
        break;
      } catch (cause) {
        if (!missing(cause)) throw cause;
        const pkg = record.package;
        // Do not replace an existing Package, even when its entrypoint is missing.
        let rootMissing = false;
        if (pkg) {
          try {
            await stat(pkg.root);
          } catch (error) {
            if (!missing(error)) throw error;
            rootMissing = true;
          }
        }
        if (!recovered && pkg?.temporary && rootMissing) {
          await recover(pkg.exactSource, record.path, pkg.root);
          recovered = true;
          continue;
        }
        throw new Error(`Saved extension is missing: ${record.path}`);
      }
    }
  }
}

/**
 * Validates persisted integrity records before they can control source recovery.
 */
export function validExtensionIntegrity(
  value: unknown,
  paths: unknown,
): boolean {
  if (value === undefined) return true;
  if (
    !Array.isArray(value) ||
    !Array.isArray(paths) ||
    value.length !== paths.length
  )
    return false;
  return value.every((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      return false;
    const record = entry as Record<string, unknown>;
    if (
      record.path !== paths[index] ||
      typeof record.digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(record.digest)
    )
      return false;
    if (record.package === undefined) return true;
    if (
      !record.package ||
      typeof record.package !== "object" ||
      Array.isArray(record.package)
    )
      return false;
    const pkg = record.package as Record<string, unknown>;
    return (
      typeof pkg.root === "string" &&
      !!pkg.root &&
      typeof pkg.exactSource === "string" &&
      /^(npm:|git:)/.test(pkg.exactSource) &&
      typeof pkg.temporary === "boolean" &&
      (pkg.manifestDigest === undefined ||
        (typeof pkg.manifestDigest === "string" &&
          /^[a-f0-9]{64}$/.test(pkg.manifestDigest))) &&
      (pkg.commit === undefined ||
        (typeof pkg.commit === "string" &&
          /^[a-f0-9]{40,64}$/.test(pkg.commit)))
    );
  });
}

/**
 * Hashes one small file asynchronously without traversing dependencies.
 */
async function hashFile(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

/**
 * Reads the exact checkout commit without updating or writing the repository.
 */
async function gitCommit(root: string): Promise<string> {
  const { stdout } = await execute("git", ["rev-parse", "HEAD"], {
    cwd: root,
    timeout: 5_000,
    maxBuffer: 4096,
  });
  const commit = stdout.trim();
  if (!/^[a-f0-9]{40,64}$/.test(commit))
    throw new Error(`Invalid extension Package commit: ${root}`);
  return commit;
}

/**
 * Distinguishes missing paths from permission and content errors.
 */
function missing(cause: unknown): boolean {
  return (cause as NodeJS.ErrnoException)?.code === "ENOENT";
}
