import { posix } from "node:path";
import type { ThemeRecord } from "./adapt-theme.ts";
import {
  provenanceBlock,
  rawSourceUrl,
  type UpstreamManifest,
  type UpstreamSourceConfiguration,
} from "./upstream-config.ts";

export async function fetchSourceText(
  manifest: UpstreamSourceConfiguration,
  relativePath: string,
): Promise<string> {
  const url = rawSourceUrl(manifest, relativePath);
  const response = await fetch(url, {
    headers: { "user-agent": "oh-my-pi-themes" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`failed to fetch ${url}: HTTP ${response.status}`);
  return response.text();
}

export function parseInventory(indexSource: string, themesPath: string): ThemeRecord[] {
  const importPattern = /^import\s+([A-Za-z0-9_]+)\s+from\s+"\.\/([^"/]+\.json)"\s+with\s+\{\s*type:\s*"json"\s*\};$/gm;
  const imports = new Map<string, string>();
  for (const match of indexSource.matchAll(importPattern)) {
    const variable = match[1];
    const filename = match[2];
    if (!variable || !filename) throw new Error("upstream import parser returned an empty match");
    if (imports.has(variable)) throw new Error(`duplicate upstream import ${variable}`);
    imports.set(variable, filename);
  }
  const importLineCount = indexSource.match(/^import\s+/gm)?.length ?? 0;
  if (imports.size === 0 || imports.size !== importLineCount) {
    throw new Error(
      `upstream index import format changed: parsed ${imports.size} of ${importLineCount} import lines`,
    );
  }

  const objectMatch = indexSource.match(/export const defaultThemes = \{\n([\s\S]*?)\n\};\s*$/);
  const body = objectMatch?.[1];
  if (!body) throw new Error("upstream defaultThemes declaration format changed");

  const records: ThemeRecord[] = [];
  const seenNames = new Set<string>();
  const seenVariables = new Set<string>();
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^(?:"([^"]+)"|([A-Za-z0-9-]+)):\s*([A-Za-z0-9_]+),$/);
    if (!match) throw new Error(`unrecognized defaultThemes entry: ${JSON.stringify(rawLine)}`);
    const name = match[1] ?? match[2];
    const variable = match[3];
    if (!name || !variable || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(name)) {
      throw new Error(`unsafe upstream theme entry ${JSON.stringify(rawLine)}`);
    }
    const filename = imports.get(variable);
    if (!filename) throw new Error(`defaultThemes.${name} uses unknown import ${variable}`);
    if (filename !== `${name}.json`) {
      throw new Error(`defaultThemes.${name} maps to unexpected file ${filename}`);
    }
    if (seenNames.has(name)) throw new Error(`duplicate upstream theme name ${name}`);
    if (seenVariables.has(variable)) throw new Error(`upstream import ${variable} is exported twice`);
    seenNames.add(name);
    seenVariables.add(variable);
    records.push({ name, filename, sourcePath: posix.join(themesPath, filename) });
  }
  if (records.length !== imports.size || seenVariables.size !== imports.size) {
    const unused = [...imports.keys()].filter((name) => !seenVariables.has(name));
    throw new Error(
      `upstream imports are not a one-to-one defaultThemes set; unused=[${unused.join(", ")}]`,
    );
  }
  return records.sort((a, b) => a.name.localeCompare(b.name));
}

export function buildInventory(indexSource: string, manifest: UpstreamManifest): ThemeRecord[] {
  const records = [
    ...parseInventory(indexSource, manifest.themesPath),
    ...manifest.rootThemes.map(({ name, path }) => ({
      name,
      filename: posix.basename(path),
      sourcePath: path,
    })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const duplicateNames = records.filter(
    ({ name }, index) => records.findIndex((record) => record.name === name) !== index,
  );
  if (duplicateNames.length > 0) {
    throw new Error(`duplicate complete upstream theme names: ${duplicateNames.map(({ name }) => name).join(", ")}`);
  }
  const sourcePaths = records.map(({ sourcePath }) => sourcePath);
  if (new Set(sourcePaths).size !== sourcePaths.length) {
    throw new Error("complete upstream theme inventory contains duplicate source paths");
  }
  return records;
}

export function updateReadmeProvenance(
  readme: string,
  manifest: UpstreamSourceConfiguration,
): string {
  const pattern = /<!-- upstream-provenance:start -->[\s\S]*?<!-- upstream-provenance:end -->/g;
  const matches = readme.match(pattern) ?? [];
  if (matches.length !== 1) {
    throw new Error("README.md must contain exactly one managed upstream provenance block");
  }
  return readme.replace(pattern, provenanceBlock(manifest));
}
