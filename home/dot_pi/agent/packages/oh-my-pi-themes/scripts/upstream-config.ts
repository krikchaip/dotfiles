import { posix } from "node:path";
import { assertExactKeys, assertRecord } from "./theme-contract.ts";

export interface UpstreamThemeSource {
  name: string;
  path: string;
}

export interface UpstreamSourceConfiguration {
  repository: string;
  commit: string;
  indexPath: string;
  themesPath: string;
  rootThemes: UpstreamThemeSource[];
}

export interface UpstreamManifest extends UpstreamSourceConfiguration {
  themes: string[];
}

const SOURCE_KEYS = ["repository", "commit", "indexPath", "themesPath", "rootThemes"] as const;
const MANIFEST_KEYS = [...SOURCE_KEYS, "themes"] as const;

export function assertSafeRelativePath(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (value.includes("\\") || value.includes("\0") || posix.isAbsolute(value)) {
    throw new Error(`${label} must be a safe POSIX relative path`);
  }
  const normalized = posix.normalize(value);
  if (normalized !== value || value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${label} must not contain empty, dot, or parent segments`);
  }
}

function repositoryCoordinates(repository: string): { owner: string; repo: string } {
  let url: URL;
  try {
    url = new URL(repository);
  } catch {
    throw new Error("upstream.json repository must be a valid URL");
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.search || url.hash) {
    throw new Error("upstream.json repository must be an HTTPS github.com repository URL");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2) {
    throw new Error("upstream.json repository must identify one GitHub owner and repository");
  }
  const owner = parts[0];
  const repo = parts[1]?.replace(/\.git$/, "");
  const safeComponent = /^[A-Za-z0-9_.-]+$/;
  if (!owner || !repo || !safeComponent.test(owner) || !safeComponent.test(repo)) {
    throw new Error("upstream.json repository contains unsupported owner or repository characters");
  }
  return { owner, repo };
}

export async function readUpstreamManifest(manifestPath: string): Promise<UpstreamManifest> {
  let value: unknown;
  try {
    value = await Bun.file(manifestPath).json();
  } catch (error) {
    throw new Error(`cannot read upstream.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  assertRecord(value, "upstream.json");
  assertExactKeys(Object.keys(value), MANIFEST_KEYS, "upstream.json");

  const { repository, commit, indexPath, themesPath, rootThemes, themes } = value;
  if (typeof repository !== "string") throw new Error("upstream.json repository must be a string");
  repositoryCoordinates(repository);
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/i.test(commit)) {
    throw new Error("upstream.json commit must be a full 40-character Git commit");
  }
  assertSafeRelativePath(indexPath, "upstream.json indexPath");
  assertSafeRelativePath(themesPath, "upstream.json themesPath");
  if (!Array.isArray(rootThemes)) {
    throw new Error("upstream.json rootThemes must be an array");
  }
  const parsedRootThemes = rootThemes.map((entry, index) => {
    assertRecord(entry, `upstream.json rootThemes[${index}]`);
    assertExactKeys(Object.keys(entry), ["name", "path"], `upstream.json rootThemes[${index}]`);
    const { name, path } = entry;
    if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(name)) {
      throw new Error(`upstream.json rootThemes[${index}].name is invalid`);
    }
    assertSafeRelativePath(path, `upstream.json rootThemes[${index}].path`);
    if (!path.endsWith(`/${name}.json`)) {
      throw new Error(`upstream.json rootThemes[${index}].path must end with /${name}.json`);
    }
    return { name, path };
  });
  const rootNames = parsedRootThemes.map(({ name }) => name);
  const sortedRootNames = [...rootNames].sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(rootNames) !== JSON.stringify(sortedRootNames)) {
    throw new Error("upstream.json rootThemes must be sorted by name");
  }
  if (new Set(rootNames).size !== rootNames.length) {
    throw new Error("upstream.json rootThemes contains duplicate names");
  }
  if (!Array.isArray(themes) || !themes.every((name) => typeof name === "string")) {
    throw new Error("upstream.json themes must be a string array");
  }
  return { repository, commit, indexPath, themesPath, rootThemes: parsedRootThemes, themes };
}

export function sourceConfiguration(manifest: UpstreamManifest): UpstreamSourceConfiguration {
  return Object.fromEntries(SOURCE_KEYS.map((key) => [key, manifest[key]])) as unknown as UpstreamSourceConfiguration;
}

function sourceUrl(
  host: "github.com" | "raw.githubusercontent.com",
  manifest: UpstreamSourceConfiguration,
  relativePath: string,
  includeBlobSegment: boolean,
): string {
  assertSafeRelativePath(relativePath, "upstream source path");
  const { owner, repo } = repositoryCoordinates(manifest.repository);
  const path = relativePath.split("/").map(encodeURIComponent).join("/");
  const middle = includeBlobSegment ? `/blob/${manifest.commit}` : `/${manifest.commit}`;
  return `https://${host}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${middle}/${path}`;
}

export function rawSourceUrl(manifest: UpstreamSourceConfiguration, relativePath: string): string {
  return sourceUrl("raw.githubusercontent.com", manifest, relativePath, false);
}

export function blobSourceUrl(manifest: UpstreamSourceConfiguration, relativePath: string): string {
  return sourceUrl("github.com", manifest, relativePath, true);
}

export function provenanceBlock(manifest: UpstreamSourceConfiguration): string {
  return [
    "<!-- upstream-provenance:start -->",
    `- Upstream repository: <${manifest.repository}>`,
    `- Pinned theme index: <${blobSourceUrl(manifest, manifest.indexPath)}>`,
    ...manifest.rootThemes.map(
      ({ name, path }) => `- Pinned root ${name} theme: <${blobSourceUrl(manifest, path)}>`,
    ),
    `- Pinned upstream license: <${blobSourceUrl(manifest, "LICENSE")}>`,
    "- Target Pi theme schema: <https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json>",
    "<!-- upstream-provenance:end -->",
  ].join("\n");
}
