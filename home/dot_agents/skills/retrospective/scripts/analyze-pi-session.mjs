#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_HEADER_BYTES = 1024 * 1024;
const SNAPSHOT_ATTEMPTS = 3;

function error(message) {
  throw new Error(message);
}

function canonicalPath(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function readExact(fd, length) {
  const output = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const count = readSync(fd, output, offset, length - offset, offset);
    if (count === 0) error(`Session became shorter while it was being read`);
    offset += count;
  }
  return output;
}

function readPrefix(path, length) {
  const fd = openSync(path, "r");
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile()) error(`Pi session is not a regular file: ${path}`);
    if (stats.size < length) error(`Pi session became shorter while it was being read: ${path}`);
    return { bytes: readExact(fd, length), size: stats.size };
  } finally {
    closeSync(fd);
  }
}

export function snapshotSessionFile(path, attempts = SNAPSHOT_ATTEMPTS) {
  const sourcePath = canonicalPath(path);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const initialFd = openSync(sourcePath, "r");
    let first;
    let cutoffBytes;
    try {
      const stats = fstatSync(initialFd);
      if (!stats.isFile()) error(`Pi session is not a regular file: ${sourcePath}`);
      cutoffBytes = stats.size;
      first = readExact(initialFd, cutoffBytes);
    } finally {
      closeSync(initialFd);
    }

    const second = readPrefix(sourcePath, cutoffBytes);
    const firstHash = createHash("sha256").update(first).digest("hex");
    const secondHash = createHash("sha256").update(second.bytes).digest("hex");
    if (firstHash === secondHash) {
      return {
        bytes: first,
        sourcePath,
        cutoffBytes,
        grewDuringSnapshot: second.size > cutoffBytes,
        snapshotAt: new Date().toISOString(),
        sha256: firstHash,
      };
    }
  }

  error(`Pi session changed while its snapshot was being read: ${sourcePath}`);
}

function parseLine(line, lineNumber, sourcePath, completed) {
  if (!line.trim()) return undefined;
  try {
    return JSON.parse(line);
  } catch (cause) {
    const kind = completed ? "Malformed JSON on completed line" : "Incomplete final JSON record on line";
    error(`${kind} ${lineNumber} of ${sourcePath}: ${cause.message}`);
  }
}

export function parseSessionSnapshot(bytes, sourcePath = "<snapshot>") {
  const text = bytes.toString("utf8");
  const endsWithNewline = text.endsWith("\n");
  const lines = text.split("\n");
  if (endsWithNewline) lines.pop();

  const parsed = [];
  for (let index = 0; index < lines.length; index += 1) {
    const completed = index < lines.length - 1 || endsWithNewline;
    const line = lines[index].endsWith("\r") ? lines[index].slice(0, -1) : lines[index];
    const entry = parseLine(line, index + 1, sourcePath, completed);
    if (entry !== undefined) parsed.push(entry);
  }

  const header = parsed.shift();
  if (!header || header.type !== "session" || typeof header.id !== "string") {
    error(`Missing or invalid Pi session header: ${sourcePath}`);
  }

  return { header, entries: parsed };
}

function readHeader(path) {
  const fd = openSync(path, "r");
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile()) return undefined;
    const length = Math.min(stats.size, MAX_HEADER_BYTES);
    const bytes = readExact(fd, length);
    const newline = bytes.indexOf(0x0a);
    const line = bytes.subarray(0, newline >= 0 ? newline : bytes.length).toString("utf8").replace(/\r$/, "");
    const header = JSON.parse(line);
    return header.type === "session" && typeof header.id === "string" ? header : undefined;
  } catch {
    return undefined;
  } finally {
    closeSync(fd);
  }
}

function collectJsonlFiles(root, output, depth = 0) {
  if (depth > 3) return;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) collectJsonlFiles(path, output, depth + 1);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) output.add(canonicalPath(path));
  }
}

export function defaultPiSessionRoots(env = process.env) {
  const roots = new Set();
  const agentDir = env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  roots.add(resolve(agentDir, "sessions"));
  if (env.PI_CODING_AGENT_SESSION_DIR) roots.add(resolve(env.PI_CODING_AGENT_SESSION_DIR));
  if (env.PI_SESSION_FILE) roots.add(dirname(resolve(env.PI_SESSION_FILE)));
  return [...roots];
}

function pathIdentifier(identifier) {
  const expanded = identifier === "~" || identifier.startsWith("~/")
    ? join(homedir(), identifier.slice(2))
    : identifier;
  const path = isAbsolute(expanded) ? expanded : resolve(expanded);
  try {
    return statSync(path).isFile() ? canonicalPath(path) : undefined;
  } catch {
    return undefined;
  }
}

export function resolvePiSession(identifier, options = {}) {
  if (typeof identifier !== "string" || !identifier.trim()) {
    error(`A Pi session identifier is required`);
  }

  const directPath = pathIdentifier(identifier.trim());
  if (directPath) {
    const header = readHeader(directPath);
    if (!header) error(`Path is not a readable Pi session: ${directPath}`);
    return directPath;
  }

  const files = new Set();
  for (const root of options.sessionRoots ?? defaultPiSessionRoots(options.env)) {
    collectJsonlFiles(root, files);
  }

  const candidates = [...files]
    .map((path) => ({ path, header: readHeader(path) }))
    .filter(({ header }) => header);
  const token = identifier.trim();
  const exact = candidates.filter(({ header }) => header.id === token);
  if (exact.length === 1) return exact[0].path;
  if (exact.length > 1) {
    error(
      `Ambiguous Pi session identifier ${JSON.stringify(token)}. Exact matches:\n${exact
        .map(({ path, header }) => `- ${header.id} (${header.cwd ?? "unknown cwd"}): ${path}`)
        .join("\n")}`,
    );
  }

  const prefixes = candidates.filter(({ header }) => header.id.startsWith(token));
  if (prefixes.length === 1) return prefixes[0].path;
  if (prefixes.length > 1) {
    error(
      `Ambiguous Pi session identifier ${JSON.stringify(token)}. Matches:\n${prefixes
        .map(({ path, header }) => `- ${header.id} (${header.cwd ?? "unknown cwd"}): ${path}`)
        .join("\n")}`,
    );
  }

  error(`Pi session not found: ${JSON.stringify(token)}`);
}

export function selectActiveBranch(entries, version = 3) {
  if (version < 2) return [...entries];
  if (entries.length === 0) return [];

  const byId = new Map();
  for (const entry of entries) {
    if (typeof entry.id !== "string" || !entry.id) {
      error(`Pi session v${version} contains an entry without an ID`);
    }
    if (byId.has(entry.id)) error(`Pi session contains duplicate entry ID: ${entry.id}`);
    byId.set(entry.id, entry);
  }

  const reversed = [];
  const visited = new Set();
  let current = entries.at(-1);
  while (current) {
    if (visited.has(current.id)) error(`Pi session active branch contains a cycle at ${current.id}`);
    visited.add(current.id);
    reversed.push(current);
    if (current.parentId == null) break;
    const parent = byId.get(current.parentId);
    if (!parent) error(`Broken Pi session parent chain: ${current.id} -> ${current.parentId}`);
    current = parent;
  }
  return reversed.reverse();
}

function contentParts(content) {
  if (typeof content === "string") return { text: content, images: [] };
  if (!Array.isArray(content)) return { text: "", images: [] };

  const text = [];
  const images = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string") text.push(block.text);
    else if (block.type === "image" && typeof block.data === "string") {
      images.push({ mimeType: block.mimeType ?? "application/octet-stream", data: block.data });
    }
  }
  return { text: text.join("\n"), images };
}

function toolCalls(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((block) => block?.type === "toolCall")
    .map((block) => ({ id: block.id, name: block.name, arguments: block.arguments ?? {} }));
}

function normalizeMessageEntry(entry, position) {
  if (entry.type !== "message" || !entry.message) return undefined;
  const message = entry.message;
  const base = {
    type: "message",
    position,
    entryId: entry.id,
    timestamp: entry.timestamp ?? message.timestamp,
    role: message.role,
  };

  if (message.role === "user") return { ...base, ...contentParts(message.content) };
  if (message.role === "assistant") {
    return {
      ...base,
      ...contentParts(message.content),
      toolCalls: toolCalls(message.content),
      stopReason: message.stopReason,
      errorMessage: message.errorMessage,
    };
  }
  if (message.role === "toolResult") {
    return {
      ...base,
      ...contentParts(message.content),
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      isError: Boolean(message.isError),
    };
  }
  if (message.role === "bashExecution") {
    return {
      ...base,
      command: message.command,
      text: message.output ?? "",
      exitCode: message.exitCode,
      cancelled: Boolean(message.cancelled),
      truncated: Boolean(message.truncated),
      fullOutputPath: message.fullOutputPath,
    };
  }
  return undefined;
}

export function analyzePiSession(identifier, options = {}) {
  const sourcePath = resolvePiSession(identifier, options);
  const snapshot = snapshotSessionFile(sourcePath, options.snapshotAttempts);
  const parsed = parseSessionSnapshot(snapshot.bytes, sourcePath);
  const activeBranch = selectActiveBranch(parsed.entries, parsed.header.version ?? 1);

  const messages = [];
  for (const entry of activeBranch) {
    const normalized = normalizeMessageEntry(entry, messages.length + 1);
    if (normalized) messages.push(normalized);
  }

  let sessionName;
  for (const entry of activeBranch) {
    if (entry.type === "session_info" && typeof entry.name === "string") sessionName = entry.name;
  }

  const metadata = {
    type: "retrospective_session",
    harness: "pi",
    sessionId: parsed.header.id,
    sessionName,
    cwd: parsed.header.cwd,
    sourcePath,
    snapshotAt: snapshot.snapshotAt,
    cutoffBytes: snapshot.cutoffBytes,
    cutoffEntryId: activeBranch.at(-1)?.id ?? null,
    grewDuringSnapshot: snapshot.grewDuringSnapshot,
    activeBranchEntryCount: activeBranch.length,
    messageCount: messages.length,
    compactionCount: activeBranch.filter((entry) => entry.type === "compaction").length,
    sha256: snapshot.sha256,
  };

  return { metadata, messages };
}

export function serializeAnalysis(result) {
  return `${[result.metadata, ...result.messages].map((value) => JSON.stringify(value)).join("\n")}\n`;
}

function imageExtension(mimeType) {
  return {
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  }[mimeType] ?? "bin";
}

export function writeAnalysis(result, outputPath) {
  const output = resolve(outputPath);
  const imageCount = result.messages.reduce((count, message) => count + (message.images?.length ?? 0), 0);
  const assetsDirectory = imageCount > 0 ? `${output}.assets` : undefined;
  if (assetsDirectory) mkdirSync(assetsDirectory, { mode: 0o700 });

  let imageNumber = 0;
  const messages = result.messages.map((message) => ({
    ...message,
    images: (message.images ?? []).map((image) => {
      imageNumber += 1;
      const path = join(
        assetsDirectory,
        `message-${String(message.position).padStart(5, "0")}-${String(imageNumber).padStart(3, "0")}.${imageExtension(image.mimeType)}`,
      );
      const bytes = Buffer.from(image.data, "base64");
      writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
      return { mimeType: image.mimeType, path, bytes: bytes.length };
    }),
  }));
  const materialized = {
    metadata: { ...result.metadata, assetsDirectory, imageCount },
    messages,
  };
  writeFileSync(output, serializeAnalysis(materialized), { flag: "wx", mode: 0o600 });
  return materialized.metadata;
}

function parseArguments(argv) {
  let output;
  let identifier;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--output") {
      output = argv[++index];
      if (!output) error(`--output requires a path`);
    } else if (value === "--") {
      identifier = argv[index + 1];
      if (index + 2 < argv.length) error(`The Pi analyzer accepts one session identifier per run`);
      break;
    } else if (!identifier) identifier = value;
    else error(`The Pi analyzer accepts one session identifier per run`);
  }
  if (!identifier) error(`Usage: analyze-pi-session.mjs [--output <jsonl>] <session-id-or-path>`);
  return { identifier, output };
}

function main() {
  const { identifier, output } = parseArguments(process.argv.slice(2));
  const result = analyzePiSession(identifier);
  if (output) {
    const metadata = writeAnalysis(result, output);
    process.stdout.write(`${JSON.stringify({ ...metadata, output: resolve(output) })}\n`);
  } else {
    if (result.messages.some((message) => message.images?.length > 0)) {
      error(`This transcript contains images; use --output so the analyzer can write private image files`);
    }
    process.stdout.write(serializeAnalysis(result));
  }
}

const invokedPath = process.argv[1] ? canonicalPath(process.argv[1]) : undefined;
if (invokedPath === canonicalPath(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (cause) {
    process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exitCode = 1;
  }
}
