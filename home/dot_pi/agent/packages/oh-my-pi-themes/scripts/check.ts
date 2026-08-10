import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  ALLOWED_THEME_ROOT_KEYS,
  EXPORT_COLOR_TOKENS,
  GENERATED_COLOR_TOKENS,
  OMP_ONLY_COLOR_TOKENS,
  PI_SCHEMA_URL,
  assertColorValues,
  assertExactKeys,
  assertRecord,
  assertSubsetKeys,
} from "./theme-contract.ts";
import { provenanceBlock, readUpstreamManifest } from "./upstream-config.ts";

const packageDir = join(import.meta.dir, "..");
const themesDir = join(packageDir, "themes");

async function readJson(path: string, label: string): Promise<unknown> {
  try {
    return await Bun.file(path).json();
  } catch (error) {
    throw new Error(`cannot read ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const packageJson = await readJson(join(packageDir, "package.json"), "package.json");
assertRecord(packageJson, "package.json");
if (packageJson.private !== true) throw new Error("package.json must keep the local package private");
assertRecord(packageJson.pi, "package.json pi");
if (JSON.stringify(packageJson.pi.themes) !== JSON.stringify(["./themes"])) {
  throw new Error('package.json must expose only "./themes" through pi.themes');
}
assertRecord(packageJson.scripts, "package.json scripts");
for (const [name, command] of Object.entries(packageJson.scripts)) {
  if (typeof command !== "string" || command.includes("node ") || command.includes(".mjs")) {
    throw new Error(`package script ${name} must use the Bun TypeScript toolchain`);
  }
}

const scriptEntries = await readdir(import.meta.dir, { withFileTypes: true });
const obsolete = scriptEntries.filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"));
if (obsolete.length) throw new Error(`obsolete .mjs tools remain: ${obsolete.map(({ name }) => name).join(", ")}`);

const manifest = await readUpstreamManifest(join(packageDir, "upstream.json"));
if (manifest.themes.length === 0) throw new Error("upstream.json themes must not be empty");
if (JSON.stringify(manifest.rootThemes.map(({ name }) => name)) !== JSON.stringify(["dark", "light"])) {
  throw new Error("upstream.json rootThemes must contain OMP's dark and light themes");
}
const expectedNames = [...manifest.themes];
const sortedNames = [...expectedNames].sort((a, b) => a.localeCompare(b));
if (JSON.stringify(expectedNames) !== JSON.stringify(sortedNames)) {
  throw new Error("upstream.json themes must be sorted");
}
if (new Set(expectedNames).size !== expectedNames.length) {
  throw new Error("upstream.json contains duplicate theme names");
}
for (const name of expectedNames) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(name)) {
    throw new Error(`invalid theme name in upstream.json: ${JSON.stringify(name)}`);
  }
}

const readme = await Bun.file(join(packageDir, "README.md")).text();
const provenancePattern = /<!-- upstream-provenance:start -->[\s\S]*?<!-- upstream-provenance:end -->/g;
const provenanceMatches = readme.match(provenancePattern) ?? [];
if (provenanceMatches.length !== 1 || provenanceMatches[0] !== provenanceBlock(manifest)) {
  throw new Error("README.md pinned source links do not match upstream.json");
}
if (readme.includes("npm run") || readme.includes(".mjs")) {
  throw new Error("README.md must document only Bun TypeScript commands");
}

const entries = await readdir(themesDir, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith(".json")) {
    throw new Error(`themes directory contains unexpected entry ${entry.name}`);
  }
}
const actualFiles = entries.map(({ name }) => name).sort((a, b) => a.localeCompare(b));
const expectedFiles = expectedNames.map((name) => `${name}.json`);
assertExactKeys(actualFiles, expectedFiles, "themes directory inventory");

const seenNames = new Set<string>();
for (const filename of actualFiles) {
  const theme = await readJson(join(themesDir, filename), filename);
  assertRecord(theme, filename);
  assertSubsetKeys(Object.keys(theme), ALLOWED_THEME_ROOT_KEYS, filename);
  if (typeof theme.name !== "string") throw new Error(`${filename} must define a string name`);
  assertRecord(theme.colors, `${filename}.colors`);
  if (theme.$schema !== PI_SCHEMA_URL) throw new Error(`${filename} has the wrong Pi schema URL`);

  const expectedName = filename.slice(0, -".json".length);
  if (theme.name !== expectedName) {
    throw new Error(`${filename} declares name ${JSON.stringify(theme.name)}`);
  }
  if (seenNames.has(theme.name)) throw new Error(`duplicate theme name ${theme.name}`);
  seenNames.add(theme.name);

  assertExactKeys(Object.keys(theme.colors), GENERATED_COLOR_TOKENS, `${filename}.colors`);
  for (const token of OMP_ONLY_COLOR_TOKENS) {
    if (Object.hasOwn(theme.colors, token)) {
      throw new Error(`${filename} retains OMP-only token ${token}`);
    }
  }
  if (theme.colors.scrollbarThumb !== theme.colors.selectedBg) {
    throw new Error(`${filename} scrollbarThumb must equal selectedBg`);
  }
  if (theme.colors.thinkingMax !== theme.colors.thinkingXhigh) {
    throw new Error(`${filename} thinkingMax must equal thinkingXhigh`);
  }
  assertColorValues(theme.vars, theme.colors, filename);

  if (theme.export !== undefined) {
    assertRecord(theme.export, `${filename}.export`);
    assertSubsetKeys(Object.keys(theme.export), EXPORT_COLOR_TOKENS, `${filename}.export`);
    assertColorValues(theme.vars, theme.export, `${filename}.export`);
  }
  if (theme.name === "dark-poimandres" || theme.name === "light-poimandres") {
    assertRecord(theme.vars, `${filename}.vars`);
    if (theme.vars.poimandresSelection !== "#717cb4") {
      throw new Error(`${filename} must strip only the upstream Poimandres alpha byte`);
    }
  }
}

assertExactKeys([...seenNames], expectedNames, "loaded theme names");
console.log(`Structurally validated ${actualFiles.length} themes from ${manifest.commit}.`);
