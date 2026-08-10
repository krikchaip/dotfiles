import { lstat, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { adaptTheme, type AdaptedTheme, type ThemeRecord } from "./adapt-theme.ts";
import { buildInventory, fetchSourceText, updateReadmeProvenance } from "./omp-source.ts";
import {
  readUpstreamManifest,
  sourceConfiguration,
  type UpstreamManifest,
} from "./upstream-config.ts";

const packageDir = join(import.meta.dir, "..");
const themesDir = join(packageDir, "themes");
const manifestPath = join(packageDir, "upstream.json");
const readmePath = join(packageDir, "README.md");
const licensePath = join(packageDir, "LICENSE");
const tempPrefix = ".themes-sync-";
const markerName = ".sync-state.json";

type PathType = "missing" | "file" | "directory" | "symlink" | "other";

class IncompleteRollbackError extends AggregateError {}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

async function pathType(path: string): Promise<PathType> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) return "symlink";
    if (stats.isDirectory()) return "directory";
    if (stats.isFile()) return "file";
    return "other";
  } catch (error) {
    if (errorCode(error) === "ENOENT") return "missing";
    throw error;
  }
}

function processIsRunning(pid: unknown): boolean {
  if (!Number.isSafeInteger(pid) || (pid as number) <= 0) return false;
  try {
    process.kill(pid as number, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

async function writeState(tempRoot: string): Promise<void> {
  const marker = `${JSON.stringify({ pid: process.pid })}\n`;
  const nextPath = join(tempRoot, `${markerName}.next`);
  await Bun.write(nextPath, marker);
  await rename(nextPath, join(tempRoot, markerName));
}

async function recoverInterruptedSyncs(): Promise<void> {
  const entries = await readdir(packageDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.name.startsWith(tempPrefix)) continue;
    if (!entry.isDirectory() || !/^\.themes-sync-[A-Za-z0-9_-]+$/.test(entry.name)) {
      throw new Error(`refusing unsafe interrupted-sync entry: ${entry.name}`);
    }
    const tempRoot = join(packageDir, entry.name);
    let state: unknown;
    try {
      state = await Bun.file(join(tempRoot, markerName)).json();
    } catch (error) {
      throw new Error(
        `cannot safely recover ${entry.name}: invalid sync marker (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    const pid =
      typeof state === "object" && state !== null && "pid" in state
        ? (state as { pid?: unknown }).pid
        : undefined;
    if (processIsRunning(pid)) throw new Error(`another theme sync is running with PID ${pid}`);

    const backupDir = join(tempRoot, "previous-themes");
    const stagedManifest = join(tempRoot, "upstream.json");
    const activeType = await pathType(themesDir);
    const backupType = await pathType(backupDir);
    if (backupType === "directory" && activeType === "missing") {
      await rename(backupDir, themesDir);
    } else if (backupType === "directory" && activeType === "directory") {
      if ((await pathType(stagedManifest)) === "file") {
        const discardedDir = join(tempRoot, "interrupted-new-themes");
        await rename(themesDir, discardedDir);
        await rename(backupDir, themesDir);
      }
    } else if (activeType !== "directory") {
      throw new Error(`cannot safely recover ${entry.name}: no complete theme directory exists`);
    }
    await rm(tempRoot, { recursive: true, force: false });
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  map: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) throw new Error(`missing work item at index ${index}`);
      results[index] = await map(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function fetchThemes(
  manifest: UpstreamManifest,
  inventory: readonly ThemeRecord[],
): Promise<Array<{ record: ThemeRecord; theme: AdaptedTheme }>> {
  return mapWithConcurrency(inventory, 8, async (record) => {
    const sourceText = await fetchSourceText(manifest, record.sourcePath);
    let source: unknown;
    try {
      source = JSON.parse(sourceText) as unknown;
    } catch (error) {
      throw new Error(
        `invalid upstream JSON in ${record.filename}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { record, theme: adaptTheme(source, record) };
  });
}

async function installSnapshot(
  tempRoot: string,
  stagedThemes: string,
  stagedManifest: string,
): Promise<void> {
  const backupDir = join(tempRoot, "previous-themes");
  const discardedDir = join(tempRoot, "discarded-themes");
  let oldMoved = false;
  let newInstalled = false;
  let manifestInstalled = false;
  try {
    const currentType = await pathType(themesDir);
    if (currentType !== "missing" && currentType !== "directory") {
      throw new Error(`refusing to replace themes/: expected a directory, found ${currentType}`);
    }
    if (currentType === "directory") {
      await rename(themesDir, backupDir);
      oldMoved = true;
    }
    await rename(stagedThemes, themesDir);
    newInstalled = true;
    await rename(stagedManifest, manifestPath);
    manifestInstalled = true;
  } catch (error) {
    if (manifestInstalled) throw error;
    try {
      if (newInstalled && (await pathType(themesDir)) === "directory") {
        await rename(themesDir, discardedDir);
      }
      if (oldMoved && (await pathType(backupDir)) === "directory") {
        await rename(backupDir, themesDir);
      }
    } catch (rollbackError) {
      throw new IncompleteRollbackError(
        [error, rollbackError],
        "theme snapshot installation failed and rollback was incomplete",
      );
    }
    throw error;
  }
}

await recoverInterruptedSyncs();
const manifest = await readUpstreamManifest(manifestPath);
const indexSource = await fetchSourceText(manifest, manifest.indexPath);
const inventory = buildInventory(indexSource, manifest);
const [adaptedThemes, upstreamLicense, currentReadme] = await Promise.all([
  fetchThemes(manifest, inventory),
  fetchSourceText(manifest, "LICENSE"),
  Bun.file(readmePath).text(),
]);
if (!upstreamLicense.startsWith("MIT License\n") || !upstreamLicense.endsWith("\n")) {
  throw new Error("upstream LICENSE format changed; refusing to replace local attribution silently");
}

const nextManifest: UpstreamManifest = {
  ...sourceConfiguration(manifest),
  themes: inventory.map(({ name }) => name),
};
const nextReadme = updateReadmeProvenance(currentReadme, nextManifest);
const tempRoot = await mkdtemp(join(packageDir, tempPrefix));
await writeState(tempRoot);
let preserveTemp = false;
try {
  const stagedThemes = join(tempRoot, "themes");
  const stagedManifest = join(tempRoot, "upstream.json");
  const stagedReadme = join(tempRoot, "README.md");
  const stagedLicense = join(tempRoot, "LICENSE");
  await mkdir(stagedThemes);
  await Promise.all(
    adaptedThemes.map(({ record, theme }) =>
      Bun.write(join(stagedThemes, record.filename), `${JSON.stringify(theme, null, 2)}\n`),
    ),
  );
  await Promise.all([
    Bun.write(stagedManifest, `${JSON.stringify(nextManifest, null, 2)}\n`),
    Bun.write(stagedReadme, nextReadme),
    Bun.write(stagedLicense, upstreamLicense),
  ]);

  await installSnapshot(tempRoot, stagedThemes, stagedManifest);
  await rename(stagedReadme, readmePath);
  await rename(stagedLicense, licensePath);
} catch (error) {
  preserveTemp = error instanceof IncompleteRollbackError;
  throw error;
} finally {
  if (!preserveTemp) await rm(tempRoot, { recursive: true, force: true });
}

console.log(`Synced ${inventory.length} themes from ${manifest.commit}.`);
