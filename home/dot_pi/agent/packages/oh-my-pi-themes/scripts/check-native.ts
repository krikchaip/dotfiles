import { realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { assertRecord } from "./theme-contract.ts";
import { readUpstreamManifest } from "./upstream-config.ts";

const SUPPORTED_PI_VERSIONS = new Set(["0.84.1", "0.84.2", "0.85.0"]);
const packageDir = join(import.meta.dir, "..");
const manifest = await readUpstreamManifest(join(packageDir, "upstream.json"));

const piExecutable = Bun.which("pi");
if (!piExecutable) {
  throw new Error("cannot run native theme validation: pi is not on PATH");
}

const resolvedExecutable = await realpath(piExecutable);
const piPackageDir = join(dirname(resolvedExecutable), "..", "@earendil-works", "pi-coding-agent");
const piPackageJson: unknown = await Bun.file(join(piPackageDir, "package.json")).json();
assertRecord(piPackageJson, "installed Pi package.json");
if (typeof piPackageJson.version !== "string") {
  throw new Error("installed Pi package.json has no string version");
}
if (!SUPPORTED_PI_VERSIONS.has(piPackageJson.version)) {
  throw new Error(
    `Pi ${piPackageJson.version} has not been validated by this snapshot; supported versions: ${[...SUPPORTED_PI_VERSIONS].join(", ")}`,
  );
}

const loaderPath = join(piPackageDir, "dist", "modes", "interactive", "theme", "theme.js");
if (!(await Bun.file(loaderPath).exists())) {
  throw new Error(`Pi ${piPackageJson.version} has no supported JavaScript theme loader at ${loaderPath}`);
}

const loaderModule: unknown = await import(pathToFileURL(loaderPath).href);
assertRecord(loaderModule, "Pi theme loader module");
const loadThemeFromPath = loaderModule.loadThemeFromPath;
if (typeof loadThemeFromPath !== "function") {
  throw new Error("installed Pi theme loader does not export loadThemeFromPath");
}

for (const name of manifest.themes) {
  loadThemeFromPath(join(packageDir, "themes", `${name}.json`), "truecolor");
}

console.log(`Pi ${piPackageJson.version} loaded ${manifest.themes.length} themes with its native loader.`);
