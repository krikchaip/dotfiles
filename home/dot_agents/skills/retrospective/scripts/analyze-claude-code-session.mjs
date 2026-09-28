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
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SNAPSHOT_ATTEMPTS = 3;
const HUMAN_ORIGINS = new Set([undefined, "human"]);
const SKIPPED_ASSISTANT_BLOCKS = new Set(["thinking", "redacted_thinking"]);

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
    if (!stats.isFile())
      error(`Claude Code transcript is not a regular file: ${path}`);
    if (stats.size < length)
      error(
        `Claude Code transcript became shorter while it was being read: ${path}`,
      );
    return { bytes: readExact(fd, length), size: stats.size };
  } finally {
    closeSync(fd);
  }
}

export function snapshotTranscriptFile(path, attempts = SNAPSHOT_ATTEMPTS) {
  const sourcePath = canonicalPath(path);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const initialFd = openSync(sourcePath, "r");
    let first;
    let cutoffBytes;
    try {
      const stats = fstatSync(initialFd);
      if (!stats.isFile())
        error(`Claude Code transcript is not a regular file: ${sourcePath}`);
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

  error(
    `Claude Code transcript changed while its snapshot was being read: ${sourcePath}`,
  );
}

export function parseTranscriptSnapshot(bytes, sourcePath = "<snapshot>") {
  const text = bytes.toString("utf8");
  const endsWithNewline = text.endsWith("\n");
  const lines = text.split("\n");
  if (endsWithNewline) lines.pop();

  const entries = [];
  for (let index = 0; index < lines.length; index += 1) {
    const completed = index < lines.length - 1 || endsWithNewline;
    const line = lines[index].endsWith("\r")
      ? lines[index].slice(0, -1)
      : lines[index];
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch (cause) {
      const kind = completed
        ? "Malformed JSON on completed line"
        : "Incomplete final JSON record on line";
      error(`${kind} ${index + 1} of ${sourcePath}: ${cause.message}`);
    }
  }
  if (!entries.some(isTranscriptEntry))
    error(`No Claude Code transcript messages in ${sourcePath}`);
  return entries;
}

function isTranscriptEntry(entry) {
  return (
    typeof entry?.uuid === "string" &&
    ["user", "assistant", "system", "attachment"].includes(entry.type)
  );
}

function isConversationEntry(entry) {
  return (
    (entry.type === "user" || entry.type === "assistant") && !entry.isSidechain
  );
}

export function defaultClaudeProjectRoots(env = process.env) {
  const configDir = env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  return [resolve(configDir, "projects")];
}

// Top-level transcripts only: <root>/<encoded-cwd>/<session-id>.jsonl. Subagent
// transcripts live one level deeper and are reported through metadata instead.
function listTranscripts(roots) {
  const files = new Set();
  for (const root of roots) {
    let projects;
    try {
      projects = readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const project of projects) {
      if (!project.isDirectory()) continue;
      let entries;
      try {
        entries = readdirSync(join(root, project.name), {
          withFileTypes: true,
        });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          files.add(canonicalPath(join(root, project.name, entry.name)));
        }
      }
    }
  }
  return [...files].map((path) => ({ path, id: basename(path, ".jsonl") }));
}

function pathIdentifier(identifier) {
  const expanded =
    identifier === "~" || identifier.startsWith("~/")
      ? join(homedir(), identifier.slice(2))
      : identifier;
  const path = isAbsolute(expanded) ? expanded : resolve(expanded);
  try {
    return statSync(path).isFile() ? canonicalPath(path) : undefined;
  } catch {
    return undefined;
  }
}

function sessionTitles(path) {
  const titles = {};
  let entries;
  try {
    entries = parseTranscriptSnapshot(snapshotTranscriptFile(path).bytes, path);
  } catch {
    return titles;
  }
  for (const entry of entries) {
    if (entry.type === "custom-title" && typeof entry.customTitle === "string")
      titles.custom = entry.customTitle;
    if (entry.type === "ai-title" && typeof entry.aiTitle === "string")
      titles.ai = entry.aiTitle;
  }
  return titles;
}

function describeMatches(matches) {
  return matches.map(({ id, path }) => `- ${id}: ${path}`).join("\n");
}

export function resolveClaudeCodeSession(identifier, options = {}) {
  if (typeof identifier !== "string" || !identifier.trim()) {
    error(`A Claude Code session identifier is required`);
  }
  const token = identifier.trim();

  const directPath = pathIdentifier(token);
  if (directPath) {
    if (!directPath.endsWith(".jsonl"))
      error(`Path is not a Claude Code transcript: ${directPath}`);
    return directPath;
  }

  const transcripts = listTranscripts(
    options.projectRoots ?? defaultClaudeProjectRoots(options.env),
  );
  const exact = transcripts.filter(({ id }) => id === token);
  if (exact.length === 1) return exact[0].path;
  if (exact.length > 1) {
    error(
      `Ambiguous Claude Code session identifier ${JSON.stringify(token)}. Exact matches:\n${describeMatches(exact)}`,
    );
  }

  const prefixes = transcripts.filter(({ id }) => id.startsWith(token));
  if (prefixes.length === 1) return prefixes[0].path;
  if (prefixes.length > 1) {
    error(
      `Ambiguous Claude Code session identifier ${JSON.stringify(token)}. Matches:\n${describeMatches(prefixes)}`,
    );
  }

  const titled = transcripts.filter(({ path }) => {
    const titles = sessionTitles(path);
    return (titles.custom ?? titles.ai) === token;
  });
  if (titled.length === 1) return titled[0].path;
  if (titled.length > 1) {
    error(
      `Ambiguous Claude Code session title ${JSON.stringify(token)}. Matches:\n${describeMatches(titled)}`,
    );
  }

  error(`Claude Code session not found: ${JSON.stringify(token)}`);
}

function nearestConversationEntry(byUuid, uuid) {
  const visited = new Set();
  let current = byUuid.get(uuid);
  while (current && !visited.has(current.uuid)) {
    visited.add(current.uuid);
    if (isConversationEntry(current)) return current;
    current = current.parentUuid ? byUuid.get(current.parentUuid) : undefined;
  }
  return undefined;
}

function descendsFrom(byUuid, entry, ancestorUuid) {
  const visited = new Set();
  let current = entry;
  while (current && !visited.has(current.uuid)) {
    if (current.uuid === ancestorUuid) return true;
    visited.add(current.uuid);
    const parent = current.parentUuid ?? current.logicalParentUuid;
    current = parent ? byUuid.get(parent) : undefined;
  }
  return false;
}

// Mirrors Claude Code's resume choice: the newest conversation message wins,
// unless a later `last-prompt` record moved the leaf to another branch.
export function selectLeaf(entries, byUuid) {
  let latest;
  let latestIndex = -1;
  let pointer;
  let pointerIndex = -1;
  entries.forEach((entry, index) => {
    if (isTranscriptEntry(entry) && isConversationEntry(entry)) {
      latest = entry;
      latestIndex = index;
    } else if (
      entry.type === "last-prompt" &&
      typeof entry.leafUuid === "string" &&
      byUuid.has(entry.leafUuid)
    ) {
      pointer = entry.leafUuid;
      pointerIndex = index;
    }
  });

  const pointed = pointer
    ? nearestConversationEntry(byUuid, pointer)
    : undefined;
  if (
    pointed &&
    pointerIndex > latestIndex &&
    latest &&
    !descendsFrom(byUuid, latest, pointed.uuid)
  ) {
    return { leaf: pointed, source: "last-prompt" };
  }
  return latest ? { leaf: latest, source: "latest-message" } : undefined;
}

function toolResultBlocks(entry) {
  const content = entry.message?.content;
  return Array.isArray(content)
    ? content.filter((block) => block?.type === "tool_result")
    : [];
}

function toolUseIds(entry) {
  const content = entry.message?.content;
  return Array.isArray(content)
    ? content
        .filter(
          (block) =>
            block?.type === "tool_use" || block?.type === "server_tool_use",
        )
        .map((block) => block.id)
    : [];
}

// Parallel tool calls fork the parent chain: each tool result points at the
// assistant entry that issued its call, and assistant blocks from one API
// response are written as sibling entries. Pull those companions back in.
function addCompanions(entries, active) {
  let changed = true;
  while (changed) {
    changed = false;
    const messageIds = new Set();
    const callIds = new Set();
    for (const entry of entries) {
      if (!active.has(entry.uuid) || entry.type !== "assistant") continue;
      if (entry.message?.id) messageIds.add(entry.message.id);
      for (const id of toolUseIds(entry)) callIds.add(id);
    }

    for (const entry of entries) {
      if (
        !isTranscriptEntry(entry) ||
        active.has(entry.uuid) ||
        entry.isSidechain
      )
        continue;
      const anchored =
        active.has(entry.parentUuid) ||
        active.has(entry.sourceToolAssistantUUID);
      if (!anchored) continue;
      const companion =
        (entry.type === "assistant" && messageIds.has(entry.message?.id)) ||
        (entry.type === "user" &&
          toolResultBlocks(entry).some((block) =>
            callIds.has(block.tool_use_id),
          )) ||
        (entry.type === "system" && entry.subtype === "local_command");
      if (companion) {
        active.add(entry.uuid);
        changed = true;
      }
    }
  }
}

export function selectActiveBranch(entries) {
  const transcript = entries.filter(isTranscriptEntry);
  const byUuid = new Map();
  for (const entry of transcript) {
    if (byUuid.has(entry.uuid))
      error(
        `Claude Code transcript contains duplicate entry UUID: ${entry.uuid}`,
      );
    byUuid.set(entry.uuid, entry);
  }

  const selected = selectLeaf(entries, byUuid);
  if (!selected) return { branch: [], leaf: undefined, leafSource: undefined };

  const active = new Set();
  let unbridgedCompaction;
  let current = selected.leaf;
  while (current) {
    if (active.has(current.uuid))
      error(`Claude Code active branch contains a cycle at ${current.uuid}`);
    active.add(current.uuid);
    if (current.parentUuid != null) {
      const next = byUuid.get(current.parentUuid);
      if (!next)
        error(
          `Broken Claude Code parent chain: ${current.uuid} -> ${current.parentUuid}`,
        );
      current = next;
      continue;
    }
    // A compaction boundary starts a new physical chain; its logical parent
    // joins the pre-compaction history. A forked session copies only the
    // post-compaction entries, so that parent is missing or already visited.
    const logicalParent = current.logicalParentUuid;
    if (logicalParent == null) break;
    const next = byUuid.get(logicalParent);
    if (!next || active.has(logicalParent)) {
      unbridgedCompaction = {
        boundaryEntryId: current.uuid,
        logicalParentUuid: logicalParent,
      };
      break;
    }
    current = next;
  }
  addCompanions(transcript, active);

  return {
    branch: transcript.filter((entry) => active.has(entry.uuid)),
    leaf: selected.leaf,
    leafSource: selected.source,
    unbridgedCompaction,
  };
}

function imageFromBlock(block) {
  const source = block.source ?? {};
  if (source.type === "base64" && typeof source.data === "string") {
    return {
      mimeType: source.media_type ?? "application/octet-stream",
      data: source.data,
    };
  }
  return {
    mimeType: source.media_type,
    sourceType: source.type,
    url: source.url,
    fileId: source.file_id,
  };
}

function contentParts(content) {
  if (typeof content === "string") return { text: content, images: [] };
  if (!Array.isArray(content)) return { text: "", images: [] };

  const text = [];
  const images = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string")
      text.push(block.text);
    else if (block.type === "image") images.push(imageFromBlock(block));
    else if (block.type !== "tool_result") text.push(`[${block.type}]`);
  }
  return { text: text.join("\n"), images };
}

function userRecord(entry, base) {
  const records = [];
  const content = entry.message?.content;
  const parts = contentParts(content);
  const origin = entry.origin?.kind;
  if (parts.text || parts.images.length > 0) {
    const harness = entry.isMeta === true || !HUMAN_ORIGINS.has(origin);
    records.push({
      ...base,
      role: harness ? "harness" : "user",
      ...(harness && { source: entry.isMeta ? "meta" : `origin:${origin}` }),
      ...parts,
    });
  }
  for (const block of toolResultBlocks(entry)) {
    records.push({
      ...base,
      role: "toolResult",
      toolCallId: block.tool_use_id,
      isError: Boolean(block.is_error),
      ...contentParts(block.content),
    });
  }
  return records;
}

function assistantParts(entry) {
  const text = [];
  const toolCalls = [];
  const serverToolResults = [];
  for (const block of entry.message?.content ?? []) {
    if (
      !block ||
      typeof block !== "object" ||
      SKIPPED_ASSISTANT_BLOCKS.has(block.type)
    )
      continue;
    if (block.type === "text" && typeof block.text === "string")
      text.push(block.text);
    else if (block.type === "tool_use" || block.type === "server_tool_use") {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: block.input ?? {},
        ...(block.type === "server_tool_use" && { server: true }),
      });
    } else if (block.type.endsWith("_tool_result")) {
      serverToolResults.push({
        type: block.type,
        toolCallId: block.tool_use_id,
        content: block.content,
      });
    } else text.push(`[${block.type}]`);
  }
  return { text, toolCalls, serverToolResults };
}

function attachmentRecord(entry, base) {
  const attachment = entry.attachment ?? {};
  if (attachment.type === "queued_command") {
    const human =
      attachment.commandMode === "prompt" &&
      HUMAN_ORIGINS.has(attachment.origin?.kind) &&
      !attachment.isMeta;
    return [
      {
        ...base,
        role: human ? "user" : "harness",
        source: `queued_command:${attachment.commandMode ?? "unknown"}`,
        ...contentParts(attachment.prompt),
      },
    ];
  }
  if (attachment.type === "edited_text_file") {
    return [
      {
        ...base,
        role: "harness",
        source: "edited_text_file",
        path: attachment.filename,
        text: attachment.snippet ?? "",
        images: [],
      },
    ];
  }
  return [];
}

export function normalizeBranch(branch) {
  const records = [];
  const assistants = new Map();
  const toolNames = new Map();

  for (const entry of branch) {
    const base = {
      type: "message",
      entryId: entry.uuid,
      timestamp: entry.timestamp,
    };
    if (entry.type === "user") {
      if (entry.isCompactSummary) continue;
      records.push(...userRecord(entry, base));
    } else if (entry.type === "assistant") {
      const parts = assistantParts(entry);
      for (const call of parts.toolCalls) toolNames.set(call.id, call.name);
      const messageId = entry.message?.id;
      const existing = messageId ? assistants.get(messageId) : undefined;
      if (existing) {
        existing.entryIds.push(entry.uuid);
        if (parts.text.length > 0)
          existing.text = [existing.text, ...parts.text]
            .filter(Boolean)
            .join("\n");
        existing.toolCalls.push(...parts.toolCalls);
        existing.serverToolResults.push(...parts.serverToolResults);
        existing.stopReason = entry.message?.stop_reason ?? existing.stopReason;
        continue;
      }
      const record = {
        ...base,
        entryIds: [entry.uuid],
        role: "assistant",
        model: entry.message?.model,
        text: parts.text.join("\n"),
        images: [],
        toolCalls: parts.toolCalls,
        serverToolResults: parts.serverToolResults,
        stopReason: entry.message?.stop_reason,
        ...(entry.isApiErrorMessage && {
          errorMessage: parts.text.join("\n") || entry.error,
        }),
      };
      if (messageId) assistants.set(messageId, record);
      records.push(record);
    } else if (entry.type === "system" && entry.subtype === "local_command") {
      records.push({
        ...base,
        role: "command",
        text: typeof entry.content === "string" ? entry.content : "",
        images: [],
      });
    } else if (entry.type === "attachment") {
      records.push(...attachmentRecord(entry, base));
    }
  }

  return records.map((record, index) => {
    const numbered = { type: record.type, position: index + 1, ...record };
    if (numbered.role === "toolResult")
      numbered.toolName = toolNames.get(numbered.toolCallId);
    if (numbered.serverToolResults?.length === 0)
      delete numbered.serverToolResults;
    return numbered;
  });
}

function contextFiles(branch) {
  const files = new Map();
  for (const entry of branch) {
    const attachment = entry.attachment;
    if (attachment?.type === "instructions") {
      for (const file of attachment.files ?? []) {
        if (typeof file.path === "string" && !files.has(file.path))
          files.set(file.path, file.type);
      }
    } else if (
      attachment?.type === "nested_memory" &&
      typeof attachment.path === "string"
    ) {
      if (!files.has(attachment.path))
        files.set(attachment.path, "nested_memory");
    }
  }
  return [...files].map(([path, type]) => ({ path, type }));
}

function siblingFiles(sourcePath, subdirectory) {
  const directory = join(
    dirname(sourcePath),
    basename(sourcePath, ".jsonl"),
    subdirectory,
  );
  try {
    return readdirSync(directory)
      .filter(
        (name) => name.endsWith(".jsonl") || subdirectory === "tool-results",
      )
      .map((name) => join(directory, name))
      .sort();
  } catch {
    return [];
  }
}

export function analyzeClaudeCodeSession(identifier, options = {}) {
  const sourcePath = resolveClaudeCodeSession(identifier, options);
  const snapshot = snapshotTranscriptFile(sourcePath, options.snapshotAttempts);
  const entries = parseTranscriptSnapshot(snapshot.bytes, sourcePath);
  const { branch, leaf, leafSource, unbridgedCompaction } =
    selectActiveBranch(entries);
  const messages = normalizeBranch(branch);

  let customTitle;
  let aiTitle;
  for (const entry of entries) {
    if (entry.type === "custom-title" && typeof entry.customTitle === "string")
      customTitle = entry.customTitle;
    if (entry.type === "ai-title" && typeof entry.aiTitle === "string")
      aiTitle = entry.aiTitle;
  }

  const sessionId = basename(sourcePath, ".jsonl");
  const currentSessionId = (options.env ?? process.env).CLAUDE_CODE_SESSION_ID;
  const cwds = [...new Set(branch.map((entry) => entry.cwd).filter(Boolean))];
  const active = new Set(branch.map((entry) => entry.uuid));

  const metadata = {
    type: "retrospective_session",
    harness: "claude-code",
    sessionId,
    sessionName: customTitle ?? aiTitle,
    isCurrentSession: currentSessionId ? currentSessionId === sessionId : null,
    cwd: leaf?.cwd ?? cwds.at(-1),
    cwds,
    sourcePath,
    snapshotAt: snapshot.snapshotAt,
    cutoffBytes: snapshot.cutoffBytes,
    cutoffEntryId: leaf?.uuid ?? null,
    leafSource,
    abandonedMessageCount: entries.filter(
      (entry) =>
        isTranscriptEntry(entry) &&
        isConversationEntry(entry) &&
        !active.has(entry.uuid),
    ).length,
    grewDuringSnapshot: snapshot.grewDuringSnapshot,
    activeBranchEntryCount: branch.length,
    messageCount: messages.length,
    compactionCount: branch.filter(
      (entry) =>
        entry.type === "system" && entry.subtype === "compact_boundary",
    ).length,
    unbridgedCompaction,
    forkedFromSessionIds: [
      ...new Set(
        branch.map((entry) => entry.forkedFrom?.sessionId).filter(Boolean),
      ),
    ],
    claudeCodeVersions: [
      ...new Set(branch.map((entry) => entry.version).filter(Boolean)),
    ],
    contextFiles: contextFiles(branch),
    subagentTranscripts: siblingFiles(sourcePath, "subagents"),
    persistedToolResults: siblingFiles(sourcePath, "tool-results"),
    sha256: snapshot.sha256,
  };

  return { metadata, messages };
}

export function serializeAnalysis(result) {
  return `${[result.metadata, ...result.messages].map((value) => JSON.stringify(value)).join("\n")}\n`;
}

function imageExtension(mimeType) {
  return (
    {
      "image/gif": "gif",
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    }[mimeType] ?? "bin"
  );
}

export function writeAnalysis(result, outputPath) {
  const output = resolve(outputPath);
  const imageCount = result.messages.reduce(
    (count, message) =>
      count +
      (message.images ?? []).filter((image) => image.data !== undefined).length,
    0,
  );
  const assetsDirectory = imageCount > 0 ? `${output}.assets` : undefined;
  if (assetsDirectory) mkdirSync(assetsDirectory, { mode: 0o700 });

  let imageNumber = 0;
  const messages = result.messages.map((message) => ({
    ...message,
    images: (message.images ?? []).map((image) => {
      if (image.data === undefined) return image;
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
  writeFileSync(output, serializeAnalysis(materialized), {
    flag: "wx",
    mode: 0o600,
  });
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
      if (index + 2 < argv.length)
        error(
          `The Claude Code analyzer accepts one session identifier per run`,
        );
      break;
    } else if (!identifier) identifier = value;
    else
      error(`The Claude Code analyzer accepts one session identifier per run`);
  }
  if (!identifier)
    error(
      `Usage: analyze-claude-code-session.mjs [--output <jsonl>] <session-id-prefix-title-or-path>`,
    );
  return { identifier, output };
}

function main() {
  const { identifier, output } = parseArguments(process.argv.slice(2));
  const result = analyzeClaudeCodeSession(identifier);
  if (output) {
    const metadata = writeAnalysis(result, output);
    process.stdout.write(
      `${JSON.stringify({ ...metadata, output: resolve(output) })}\n`,
    );
  } else {
    if (
      result.messages.some((message) =>
        message.images?.some((image) => image.data !== undefined),
      )
    ) {
      error(
        `This transcript contains images; use --output so the analyzer can write private image files`,
      );
    }
    process.stdout.write(serializeAnalysis(result));
  }
}

const invokedPath = process.argv[1]
  ? canonicalPath(process.argv[1])
  : undefined;
if (invokedPath === canonicalPath(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (cause) {
    process.stderr.write(
      `${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    process.exitCode = 1;
  }
}
