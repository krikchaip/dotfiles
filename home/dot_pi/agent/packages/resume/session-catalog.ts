import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  type BigIntStats,
  type Dirent,
} from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const CATALOG_VERSION = 3;
const BOUNDARY_HASH_BYTES = 4096;
const HISTORY_HASH_BYTES = 1024;
const HISTORY_HASH_SAMPLES = 16;
const BOOTSTRAP_SLICE_BYTES = 16 * 1024;
const BOOTSTRAP_TITLE_CHUNK_BYTES = 64 * 1024;
const BOOTSTRAP_TITLE_LINE_BYTES = 16 * 1024;
const BOOTSTRAP_TITLE_FILE_BYTES = 4 * 1024 * 1024;
const BOOTSTRAP_TITLE_TOTAL_BYTES = 64 * 1024 * 1024;
const SESSION_INFO_MARKER = Buffer.from('"type":"session_info"');
const MAX_FILE_OPERATIONS = 10;

let activeFileOperations = 0;
const fileOperationWaiters: Array<() => void> = [];

async function withFilePermit<T>(operation: () => Promise<T>): Promise<T> {
  if (activeFileOperations < MAX_FILE_OPERATIONS) {
    activeFileOperations++;
  } else {
    await new Promise<void>((resolve) => fileOperationWaiters.push(resolve));
  }
  try {
    return await operation();
  } finally {
    const next = fileOperationWaiters.shift();
    if (next) next();
    else activeFileOperations--;
  }
}

export interface ResumeCatalogScope {
  cwd?: string;
  sessionDir: string;
  allDirectories?: boolean;
  subscription?: object;
}

export interface ResumeCatalogOptions {
  cacheDirectory?: string;
}

interface FileFingerprint {
  dev: string;
  ino: string;
  size: number;
  mtimeNs: string;
  ctimeNs: string;
}

interface ReducedSession {
  id: string;
  cwd: string;
  parentSessionPath?: string;
  created: string;
  name?: string;
  latestSessionInfoTime?: number;
  lastActivityTime?: number;
  messageCount: number;
  hasDisplayableEntry: boolean;
  firstMessage: string;
  allMessagesText?: string;
}

interface CatalogRecord {
  fingerprint: FileFingerprint;
  completeOffset: number;
  boundaryHash: string;
  historyHash?: string;
  session: ReducedSession | null;
}

interface CatalogManifest {
  version: number;
  directory: string;
  searchGeneration?: string;
  records: Record<string, CatalogRecord>;
}

interface ReconcileResult {
  manifest: CatalogManifest;
  changed: boolean;
}

function fingerprint(stats: BigIntStats): FileFingerprint {
  return {
    dev: String(stats.dev),
    ino: String(stats.ino),
    size: Number(stats.size),
    mtimeNs: String(stats.mtimeNs),
    ctimeNs: String(stats.ctimeNs),
  };
}

async function mapLimit<T, R>(
  values: T[],
  limit: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= values.length) return;
        results[index] = await operation(values[index]!);
      }
    }),
  );
  return results;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isPlainRecord(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}

function isOptionalFiniteNumber(value: unknown) {
  return (
    value === undefined || (typeof value === "number" && Number.isFinite(value))
  );
}

function isCatalogRecord(value: unknown): value is CatalogRecord {
  if (!isPlainRecord(value) || !isPlainRecord(value.fingerprint)) return false;
  const fingerprint = value.fingerprint;
  const session = value.session;
  return (
    typeof fingerprint.dev === "string" &&
    typeof fingerprint.ino === "string" &&
    typeof fingerprint.size === "number" &&
    Number.isFinite(fingerprint.size) &&
    fingerprint.size >= 0 &&
    typeof fingerprint.mtimeNs === "string" &&
    typeof fingerprint.ctimeNs === "string" &&
    typeof value.completeOffset === "number" &&
    Number.isFinite(value.completeOffset) &&
    value.completeOffset >= 0 &&
    typeof value.boundaryHash === "string" &&
    isOptionalString(value.historyHash) &&
    (session === null ||
      (isPlainRecord(session) &&
        typeof session.id === "string" &&
        typeof session.cwd === "string" &&
        typeof session.created === "string" &&
        Number.isFinite(Date.parse(session.created)) &&
        typeof session.messageCount === "number" &&
        Number.isFinite(session.messageCount) &&
        session.messageCount >= 0 &&
        typeof session.hasDisplayableEntry === "boolean" &&
        typeof session.firstMessage === "string" &&
        isOptionalString(session.name) &&
        isOptionalString(session.parentSessionPath) &&
        isOptionalString(session.allMessagesText) &&
        isOptionalFiniteNumber(session.latestSessionInfoTime) &&
        isOptionalFiniteNumber(session.lastActivityTime)))
  );
}

function isCatalogRecords(
  value: unknown,
): value is Record<string, CatalogRecord> {
  return (
    isPlainRecord(value) &&
    Object.entries(value).every(
      ([name, record]) =>
        name.endsWith(".jsonl") &&
        !name.includes("/") &&
        !name.includes("\\") &&
        isCatalogRecord(record),
    )
  );
}

function sameFingerprint(left: FileFingerprint, right: FileFingerprint) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function extractTextContent(message: any): string {
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter((block: any) => block?.type === "text")
    .map((block: any) => block.text)
    .join(" ");
}

export function isDisplayableSessionEntry(entry: any) {
  return (
    entry &&
    entry.type !== "model_change" &&
    entry.type !== "thinking_level_change" &&
    !(entry.type === "custom_message" && entry.display === false)
  );
}

function reduceEntry(
  reduced: ReducedSession | undefined,
  entry: any,
): ReducedSession | null | undefined {
  if (!reduced) {
    if (entry?.type !== "session" || typeof entry.id !== "string") return null;
    return {
      id: entry.id,
      cwd: typeof entry.cwd === "string" ? entry.cwd : "",
      parentSessionPath:
        typeof entry.parentSession === "string"
          ? entry.parentSession
          : undefined,
      created: entry.timestamp,
      messageCount: 0,
      hasDisplayableEntry: false,
      firstMessage: "",
      allMessagesText: "",
    };
  }

  if (isDisplayableSessionEntry(entry)) {
    reduced.hasDisplayableEntry = true;
  }
  if (entry?.type === "session_info") {
    reduced.name = entry.name?.trim() || undefined;
    const timestamp = Date.parse(entry.timestamp);
    if (!Number.isNaN(timestamp)) reduced.latestSessionInfoTime = timestamp;
    return reduced;
  }

  if (entry?.type !== "message") return reduced;
  reduced.messageCount++;
  const message = entry.message;
  if (message?.role !== "user" && message?.role !== "assistant") return reduced;

  const timestamp =
    typeof message.timestamp === "number"
      ? message.timestamp
      : Date.parse(entry.timestamp);
  if (!Number.isNaN(timestamp)) {
    reduced.lastActivityTime = Math.max(
      reduced.lastActivityTime ?? 0,
      timestamp,
    );
  }

  const text = extractTextContent(message);
  if (!text) return reduced;
  if (!reduced.firstMessage && message.role === "user")
    reduced.firstMessage = text;
  reduced.allMessagesText = `${reduced.allMessagesText ? `${reduced.allMessagesText} ` : ""}${text}`;
  return reduced;
}

function parseBootstrapLines(
  buffer: Buffer,
  start: number,
  fileSize: number,
): any[] {
  let text = buffer.toString("utf8");
  if (start > 0) {
    const firstNewline = text.indexOf("\n");
    if (firstNewline < 0) return [];
    text = text.slice(firstNewline + 1);
  }
  if (start + buffer.length < fileSize) {
    const lastNewline = text.lastIndexOf("\n");
    if (lastNewline < 0) return [];
    text = text.slice(0, lastNewline);
  }
  return text.split("\n").flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    try {
      return [JSON.parse(trimmed)];
    } catch {
      return [];
    }
  });
}

type BootstrapTitleBudget = { remaining: number };

function latestBootstrapSessionInfo(
  descriptor: number,
  fileSize: number,
  budget: BootstrapTitleBudget,
): any | undefined {
  let end = fileSize;
  let scanned = 0;
  let suffix = Buffer.alloc(0);
  while (
    end > 0 &&
    scanned < BOOTSTRAP_TITLE_FILE_BYTES &&
    budget.remaining > 0
  ) {
    const length = Math.min(
      end,
      BOOTSTRAP_TITLE_CHUNK_BYTES,
      BOOTSTRAP_TITLE_FILE_BYTES - scanned,
      budget.remaining,
    );
    const start = end - length;
    const chunk = Buffer.allocUnsafe(length);
    const bytesRead = readSync(descriptor, chunk, 0, length, start);
    if (bytesRead <= 0) break;
    const readChunk = chunk.subarray(0, bytesRead);
    scanned += bytesRead;
    budget.remaining -= bytesRead;
    const searchable = suffix.length
      ? Buffer.concat([readChunk, suffix])
      : readChunk;
    let before = searchable.length;
    while (before > 0) {
      const marker = searchable.lastIndexOf(SESSION_INFO_MARKER, before - 1);
      if (marker < 0) break;
      const previousNewline = searchable.lastIndexOf(0x0a, marker);
      const nextNewline = searchable.indexOf(0x0a, marker);
      const lineEnd =
        nextNewline >= 0
          ? nextNewline
          : end === fileSize
            ? searchable.length
            : -1;
      if ((previousNewline >= 0 || start === 0) && lineEnd >= 0) {
        const line = searchable
          .subarray(previousNewline + 1, lineEnd)
          .toString("utf8")
          .trim();
        try {
          const entry = JSON.parse(line);
          if (entry?.type === "session_info") return entry;
        } catch {
          // Continue to an earlier valid session_info entry.
        }
      }
      before = marker;
    }
    suffix = Buffer.from(
      readChunk.subarray(0, Math.min(bytesRead, BOOTSTRAP_TITLE_LINE_BYTES)),
    );
    end = start;
  }
  return undefined;
}

function bootstrapRecord(
  path: string,
  stats: BigIntStats,
  titleBudget: BootstrapTitleBudget,
): CatalogRecord | undefined {
  const fileSize = Number(stats.size);
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) return undefined;

  const descriptor = openSync(path, "r");
  try {
    const headLength = Math.min(fileSize, BOOTSTRAP_SLICE_BYTES);
    const head = Buffer.allocUnsafe(headLength);
    const headBytesRead = readSync(descriptor, head, 0, headLength, 0);
    const headEntries = parseBootstrapLines(
      head.subarray(0, headBytesRead),
      0,
      fileSize,
    );
    let reduced: ReducedSession | null | undefined;
    for (const entry of headEntries) {
      reduced = reduceEntry(reduced ?? undefined, entry);
      if (reduced === null) return undefined;
    }
    if (!reduced || !Number.isFinite(Date.parse(reduced.created))) {
      return undefined;
    }

    const latestSessionInfo = latestBootstrapSessionInfo(
      descriptor,
      fileSize,
      titleBudget,
    );
    if (latestSessionInfo) reduceEntry(reduced, latestSessionInfo);

    reduced.messageCount = 0;
    reduced.allMessagesText = undefined;
    reduced.lastActivityTime = Number(stats.mtimeNs) / 1e6;
    return {
      fingerprint: fingerprint(stats),
      completeOffset: 0,
      boundaryHash: "",
      session: reduced,
    };
  } finally {
    closeSync(descriptor);
  }
}

function boundaryHash(path: string, completeOffset: number): string {
  const length = Math.min(completeOffset, BOUNDARY_HASH_BYTES);
  if (length <= 0) return createHash("sha256").digest("hex");
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(length);
    const bytesRead = readSync(
      descriptor,
      buffer,
      0,
      length,
      completeOffset - length,
    );
    return createHash("sha256")
      .update(buffer.subarray(0, bytesRead))
      .digest("hex");
  } finally {
    closeSync(descriptor);
  }
}

function historyHash(path: string, completeOffset: number): string {
  const hash = createHash("sha256");
  if (completeOffset <= 0) return hash.digest("hex");
  const length = Math.min(completeOffset, HISTORY_HASH_BYTES);
  const lastStart = completeOffset - length;
  const sampleCount = lastStart > 0 ? HISTORY_HASH_SAMPLES : 1;
  const descriptor = openSync(path, "r");
  try {
    for (let index = 0; index < sampleCount; index++) {
      const position =
        sampleCount === 1
          ? 0
          : Math.floor((lastStart * index) / (sampleCount - 1));
      const buffer = Buffer.allocUnsafe(length);
      const bytesRead = readSync(descriptor, buffer, 0, length, position);
      hash.update(`${position}:${bytesRead}:`);
      hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest("hex");
  } finally {
    closeSync(descriptor);
  }
}

async function parseFile(
  path: string,
  startOffset: number,
  initial: ReducedSession | undefined,
  beforeChunk?: () => Promise<void>,
): Promise<{ completeOffset: number; session: ReducedSession | null }> {
  let reduced: ReducedSession | null | undefined = initial;
  let pending: Buffer[] = [];
  let pendingLength = 0;
  let completeOffset = startOffset;
  const stream = createReadStream(path, { start: startOffset });

  for await (const value of stream) {
    await beforeChunk?.();
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    let lineStart = 0;
    for (;;) {
      const newline = chunk.indexOf(10, lineStart);
      if (newline < 0) break;
      const part = chunk.subarray(lineStart, newline);
      let lineBuffer = part;
      if (pendingLength > 0) {
        pending.push(part);
        lineBuffer = Buffer.concat(pending, pendingLength + part.length);
        pending = [];
        pendingLength = 0;
      }
      completeOffset += lineBuffer.length + 1;
      lineStart = newline + 1;
      const line = lineBuffer.toString("utf8").trim();
      if (!line) continue;
      try {
        reduced = reduceEntry(reduced ?? undefined, JSON.parse(line));
      } catch {
        // Match Pi: ignore malformed JSONL lines.
      }
      if (reduced === null) {
        stream.destroy();
        return { completeOffset, session: null };
      }
    }
    if (lineStart < chunk.length) {
      const part = chunk.subarray(lineStart);
      pending.push(part);
      pendingLength += part.length;
    }
  }

  if (pendingLength > 0) {
    const finalBuffer =
      pending.length === 1
        ? pending[0]!
        : Buffer.concat(pending, pendingLength);
    const finalLine = finalBuffer.toString("utf8").trim();
    if (finalLine) {
      try {
        reduced = reduceEntry(reduced ?? undefined, JSON.parse(finalLine));
        completeOffset += finalBuffer.length;
      } catch {
        // Keep an incomplete fragment outside completeOffset for a future append.
      }
    }
  }
  return { completeOffset, session: reduced ?? null };
}

function toSessionInfo(
  path: string,
  record: CatalogRecord,
  provisional = false,
  loadSearchText?: () => string,
) {
  const session = record.session;
  if (!session?.hasDisplayableEntry) return undefined;
  const headerTime = Date.parse(session.created);
  const baseModified =
    session.lastActivityTime ??
    (!Number.isNaN(headerTime)
      ? headerTime
      : Number(record.fingerprint.mtimeNs) / 1e6);
  const modified = session.name
    ? Math.max(baseModified, session.latestSessionInfoTime ?? 0)
    : baseModified;
  const info = {
    path,
    id: session.id,
    cwd: session.cwd,
    name: session.name,
    parentSessionPath: session.parentSessionPath,
    created: new Date(session.created),
    modified: new Date(modified),
    messageCount: session.messageCount,
    firstMessage: session.firstMessage || "(no messages)",
    provisional,
  } as any;
  Object.defineProperty(info, "allMessagesText", {
    enumerable: true,
    get: () => session.allMessagesText ?? loadSearchText?.() ?? "",
  });
  return info;
}

export class ResumeCatalog {
  readonly #cacheDirectory: string;
  readonly #listeners = new Map<
    string,
    Map<object | string, { cwd?: string; publish: (sessions: any[]) => void }>
  >();
  readonly #repairs = new Map<string, Promise<void>>();
  readonly #reconciles = new Map<
    string,
    { rerun: boolean; promise: Promise<ReconcileResult> }
  >();
  readonly #primes = new Map<string, Promise<void>>();
  readonly #failedPrimes = new Set<string>();
  readonly #searchCache = new Map<string, Record<string, string>>();
  readonly #provisionalResults = new WeakSet<any[]>();
  readonly #interactiveReaders = new Set<object>();
  readonly #interactiveReadWaiters = new Set<() => void>();
  readonly #snapshots = new Map<
    string,
    {
      manifest: CatalogManifest;
      persisted: boolean;
      provisional: boolean;
      needsFullRepair: boolean;
    }
  >();
  #closed = false;

  constructor(options: ResumeCatalogOptions = {}) {
    this.#cacheDirectory =
      options.cacheDirectory ??
      join(getAgentDir(), "cache", "resume", `v${CATALOG_VERSION}`);
  }

  isProvisional(sessions: any[]) {
    return this.#provisionalResults.has(sessions);
  }

  hasPersistedCatalog(scope: ResumeCatalogScope) {
    if (this.#closed || scope.allDirectories) return false;
    return this.#snapshots.get(resolve(scope.sessionDir))?.persisted ?? false;
  }

  beginInteractiveRead(reader: object) {
    if (!this.#closed) this.#interactiveReaders.add(reader);
  }

  endInteractiveRead(reader: object) {
    this.#interactiveReaders.delete(reader);
    if (this.#interactiveReaders.size > 0) return;
    for (const resume of this.#interactiveReadWaiters) resume();
    this.#interactiveReadWaiters.clear();
  }

  peek(scope: ResumeCatalogScope): any[] | undefined {
    if (this.#closed || scope.allDirectories) return undefined;
    const directory = resolve(scope.sessionDir);
    let snapshot = this.#snapshots.get(directory);
    if (!snapshot) {
      const persisted = this.#readManifest(directory);
      snapshot = {
        manifest: persisted ?? this.#bootstrap(directory),
        persisted: Boolean(persisted),
        provisional: !persisted,
        needsFullRepair: !persisted,
      };
      this.#snapshots.set(directory, snapshot);
      this.#scheduleRepair(directory);
    } else if (!snapshot.persisted) {
      const persisted = this.#readManifest(directory);
      if (persisted) {
        snapshot = {
          manifest: persisted,
          persisted: true,
          provisional: false,
          needsFullRepair: false,
        };
        this.#failedPrimes.delete(directory);
        this.#snapshots.set(directory, snapshot);
        this.#scheduleRepair(directory);
      }
    }
    return this.#sessions(
      snapshot.manifest,
      scope.cwd,
      snapshot.provisional,
    );
  }

  async prime(scope: ResumeCatalogScope): Promise<void> {
    if (this.#closed || scope.allDirectories) return;
    const directory = resolve(scope.sessionDir);
    if (
      this.#snapshots.has(directory) &&
      !this.#failedPrimes.has(directory)
    ) {
      return;
    }
    const existing = this.#primes.get(directory);
    if (existing) return existing;
    const operation = this.#primeDirectory(directory).finally(() => {
      this.#primes.delete(directory);
    });
    this.#primes.set(directory, operation);
    return operation;
  }

  async #primeDirectory(directory: string) {
    const persisted = this.#readManifest(directory);
    if (persisted) {
      this.#failedPrimes.delete(directory);
      this.#snapshots.set(directory, {
        manifest: persisted,
        persisted: true,
        provisional: false,
        needsFullRepair: false,
      });
      try {
        await this.#requestReconcile(directory, persisted);
      } catch (error) {
        if (!this.#closed) this.#failedPrimes.add(directory);
        throw error;
      }
      return;
    }
    const provisional = this.#bootstrap(directory);
    if (this.#closed) return;
    this.#snapshots.set(directory, {
      manifest: provisional,
      persisted: false,
      provisional: true,
      needsFullRepair: true,
    });
    this.#scheduleRepair(directory);
  }

  async open(
    scope: ResumeCatalogScope,
    onUpdate?: (sessions: any[]) => void,
  ): Promise<any[]> {
    if (this.#closed) return [];
    if (scope.allDirectories) return this.#openAll(scope, onUpdate);
    const directory = resolve(scope.sessionDir);
    if (onUpdate) {
      let listeners = this.#listeners.get(directory);
      if (!listeners) this.#listeners.set(directory, (listeners = new Map()));
      listeners.set(scope.subscription ?? scope.cwd ?? "*", {
        cwd: scope.cwd,
        publish: onUpdate,
      });
    }
    const priming = this.prime(scope);
    let snapshot = this.#snapshots.get(directory);
    if (!snapshot || this.#interactiveReaders.size === 0) {
      await priming;
      snapshot = this.#snapshots.get(directory);
    } else {
      void priming.catch(() => {});
    }
    if (!snapshot) return [];
    if (snapshot.needsFullRepair) this.#scheduleRepair(directory);
    return this.#sessions(snapshot.manifest, scope.cwd, snapshot.provisional);
  }

  async openExact(
    scope: ResumeCatalogScope,
    onUpdate?: (sessions: any[]) => void,
  ): Promise<any[]> {
    if (this.#closed) return [];
    if (scope.allDirectories) return this.#openAll(scope, onUpdate, true);
    const initial = await this.open(scope, onUpdate);
    if (!this.isProvisional(initial)) return initial;
    const directory = resolve(scope.sessionDir);
    const reconciliation =
      this.#reconciles.get(directory)?.promise ??
      this.#requestReconcile(directory);
    await reconciliation;
    const snapshot = this.#snapshots.get(directory);
    return snapshot
      ? this.#sessions(snapshot.manifest, scope.cwd, snapshot.provisional)
      : [];
  }

  unsubscribe(subscription: object) {
    for (const listeners of this.#listeners.values()) {
      listeners.delete(subscription);
    }
  }

  async #openAll(
    scope: ResumeCatalogScope,
    onUpdate?: (sessions: any[]) => void,
    exact = false,
  ): Promise<any[]> {
    const root = resolve(scope.sessionDir);
    let directories: string[] = [];
    try {
      const entries = await readdir(root, { withFileTypes: true });
      const resolvedEntries = await mapLimit(
        entries,
        10,
        async (entry: Dirent): Promise<string | undefined> => {
          const path = join(root, entry.name);
          if (entry.isDirectory()) return path;
          if (!entry.isSymbolicLink()) return undefined;
          return withFilePermit(async () => {
            try {
              return (await stat(path)).isDirectory() ? path : undefined;
            } catch {
              return undefined;
            }
          });
        },
      );
      directories = resolvedEntries.filter((directory): directory is string =>
        Boolean(directory),
      );
    } catch {
      return [];
    }

    const snapshots = new Map<string, any[]>();
    let initialized = false;
    const combine = () =>
      [...snapshots.values()]
        .flat()
        .sort(
          (left, right) => right.modified.getTime() - left.modified.getTime(),
        );
    const hasProvisional = () =>
      [...snapshots.values()].some((sessions) => this.isProvisional(sessions));
    const publish = () => {
      if (
        !initialized ||
        !onUpdate ||
        snapshots.size !== directories.length ||
        hasProvisional()
      ) {
        return;
      }
      onUpdate(combine());
    };
    await mapLimit(directories, 10, async (directory) => {
      const sessions = await (exact ? this.openExact : this.open).call(
        this,
        { sessionDir: directory, subscription: scope.subscription },
        onUpdate
          ? (updated) => {
              snapshots.set(directory, updated);
              publish();
            }
          : undefined,
      );
      snapshots.set(directory, sessions);
    });
    initialized = true;
    const sessions = combine();
    if (hasProvisional()) this.#provisionalResults.add(sessions);
    return sessions;
  }

  recordRename(path: string, name: string, timestamp = Date.now()) {
    const directory = resolve(join(path, ".."));
    const filename = join(path).split(/[\\/]/).pop() ?? "";
    const normalizedName = name.replace(/[\r\n]+/g, " ").trim() || undefined;
    const update = (manifest: CatalogManifest | undefined) => {
      const session = manifest?.records[filename]?.session;
      if (!session) return false;
      session.name = normalizedName;
      session.latestSessionInfoTime = timestamp;
      return true;
    };

    const persisted = this.#readManifest(directory);
    if (update(persisted)) this.#writeManifest(persisted!);
    update(this.#snapshots.get(directory)?.manifest);
    this.invalidate(directory, filename);
  }

  recordDelete(path: string) {
    if (this.#closed) return;
    const directory = resolve(join(path, ".."));
    const filename = join(path).split(/[\\/]/).pop() ?? "";
    const remove = (manifest: CatalogManifest | undefined) => {
      if (!manifest?.records[filename]) return false;
      delete manifest.records[filename];
      return true;
    };

    const snapshot = this.#snapshots.get(directory);
    const snapshotChanged = remove(snapshot?.manifest);
    this.#scheduleRepair(directory, true);

    try {
      const persisted = this.#readManifest(directory);
      if (remove(persisted)) this.#writeManifest(persisted!);
    } catch {
      // The scheduled reconciliation repairs a failed cache write.
    }

    if (snapshotChanged) {
      for (const listener of this.#listeners.get(directory)?.values() ?? []) {
        try {
          listener.publish(
            this.#sessions(
              snapshot!.manifest,
              listener.cwd,
              snapshot!.provisional,
            ),
          );
        } catch {
          // One stale picker must not prevent other picker updates or repair.
        }
      }
    }
  }

  invalidate(directory: string, filename?: string) {
    if (this.#closed) return;
    const resolved = resolve(directory);
    const snapshot = this.#snapshots.get(resolved);
    if (snapshot && filename) {
      const old = snapshot.manifest.records[filename];
      if (old) {
        try {
          const current = fingerprint(
            statSync(join(resolved, filename), { bigint: true }),
          );
          if (sameFingerprint(old.fingerprint, current)) return;
        } catch {
          snapshot.provisional = true;
        }
      }
    }
    // A coarse watcher event does not identify a stale row. Keep the last exact
    // snapshot available while the repair discovers additions and changes.
    this.#scheduleRepair(resolved, true);
  }

  async close() {
    this.#closed = true;
    this.#interactiveReaders.clear();
    for (const resume of this.#interactiveReadWaiters) resume();
    this.#interactiveReadWaiters.clear();
    this.#listeners.clear();
    this.#repairs.clear();
    this.#reconciles.clear();
    this.#primes.clear();
    this.#failedPrimes.clear();
    this.#searchCache.clear();
    this.#snapshots.clear();
  }

  #sessions(manifest: CatalogManifest, cwd?: string, provisional = false) {
    const resolvedCwd = cwd ? resolve(cwd) : undefined;
    const sessions = Object.entries(manifest.records)
      .flatMap(([name, record]) => {
        const info = toSessionInfo(
          join(manifest.directory, name),
          record,
          provisional,
          () => this.#searchText(manifest, name),
        );
        return info &&
          (!resolvedCwd ||
            (typeof info.cwd === "string" && resolve(info.cwd) === resolvedCwd))
          ? [info]
          : [];
      })
      .sort(
        (left, right) => right.modified.getTime() - left.modified.getTime(),
      );
    if (provisional) this.#provisionalResults.add(sessions);
    return sessions;
  }

  #bootstrap(directory: string): CatalogManifest {
    let entries: Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return { version: CATALOG_VERSION, directory, records: {} };
    }

    const records: Record<string, CatalogRecord> = {};
    const titleBudget = { remaining: BOOTSTRAP_TITLE_TOTAL_BYTES };
    for (const entry of entries) {
      if (
        !entry.name.endsWith(".jsonl") ||
        (!entry.isFile() && !entry.isSymbolicLink())
      ) {
        continue;
      }
      const path = join(directory, entry.name);
      try {
        const stats = statSync(path, { bigint: true });
        if (!stats.isFile()) continue;
        const record = bootstrapRecord(path, stats, titleBudget);
        if (record) records[entry.name] = record;
      } catch {
        // A concurrent replacement will be handled by exact reconciliation.
      }
    }
    return { version: CATALOG_VERSION, directory, records };
  }

  async #waitForInteractiveReads() {
    while (!this.#closed && this.#interactiveReaders.size > 0) {
      await new Promise<void>((resolve) =>
        this.#interactiveReadWaiters.add(resolve),
      );
    }
  }

  #scheduleRepair(directory: string, rerun = false) {
    if (this.#closed) return;
    if (this.#repairs.has(directory)) {
      if (rerun) void this.#requestReconcile(directory);
      return;
    }
    const repair = this.#requestReconcile(directory)
      .then(() => {})
      .catch(() => {})
      .finally(() => this.#repairs.delete(directory));
    this.#repairs.set(directory, repair);
  }

  #requestReconcile(
    directory: string,
    knownManifest?: CatalogManifest,
  ): Promise<ReconcileResult> {
    const existing = this.#reconciles.get(directory);
    if (existing) {
      existing.rerun = true;
      return existing.promise;
    }

    const state = {
      rerun: false,
      promise: undefined as unknown as Promise<ReconcileResult>,
    };
    state.promise = (async () => {
      state.rerun = false;
      let result = await this.#reconcile(directory, knownManifest);
      let changed = result.changed;
      while (state.rerun && !this.#closed) {
        state.rerun = false;
        result = await this.#reconcile(directory);
        changed ||= result.changed;
      }
      return { manifest: result.manifest, changed };
    })()
      .finally(() => {
        if (this.#reconciles.get(directory) === state) {
          this.#reconciles.delete(directory);
        }
      })
      .then((result) => {
        if (!this.#closed) {
          this.#failedPrimes.delete(directory);
          this.#snapshots.set(directory, {
            manifest: result.manifest,
            persisted: true,
            provisional: false,
            needsFullRepair: false,
          });
          if (result.changed) {
            for (const listener of
              this.#listeners.get(directory)?.values() ?? []) {
              listener.publish(
                this.#sessions(result.manifest, listener.cwd),
              );
            }
          }
        }
        return result;
      });
    this.#reconciles.set(directory, state);
    return state.promise;
  }

  async #reconcile(
    directory: string,
    knownManifest?: CatalogManifest,
  ): Promise<ReconcileResult> {
    let previous = knownManifest ?? this.#readManifest(directory);
    const records: Record<string, CatalogRecord> = {};
    let changed = !previous;
    let names: string[] = [];
    try {
      names = (await readdir(directory)).filter((name) =>
        name.endsWith(".jsonl"),
      );
    } catch {
      return {
        manifest: { version: CATALOG_VERSION, directory, records },
        changed: Boolean(previous && Object.keys(previous.records).length),
      };
    }

    const states = await mapLimit(names, 10, (name) =>
      withFilePermit(async () => {
        try {
          return {
            name,
            stats: await stat(join(directory, name), { bigint: true }),
          };
        } catch {
          return undefined;
        }
      }),
    );
    const filesChanged =
      !previous ||
      Object.keys(previous.records).length !== names.length ||
      states.some((state) => {
        if (!state) return true;
        const old = previous?.records[state.name];
        return (
          !old || !sameFingerprint(old.fingerprint, fingerprint(state.stats))
        );
      });
    let previousSearch: Record<string, string> | undefined;
    if (previous && filesChanged) {
      previousSearch = this.#readSearch(previous);
      if (!previousSearch) {
        rmSync(this.#manifestPath(directory), { force: true });
        previous = undefined;
      }
    }
    changed ||= filesChanged;

    for (const state of states) {
      if (!state) continue;
      const path = join(directory, state.name);
      const currentFingerprint = fingerprint(state.stats);
      const old = previous?.records[state.name];
      if (old && sameFingerprint(old.fingerprint, currentFingerprint)) {
        records[state.name] = old;
        continue;
      }

      let startOffset = 0;
      let initial: ReducedSession | undefined;
      if (
        old?.session &&
        previousSearch &&
        currentFingerprint.dev === old.fingerprint.dev &&
        currentFingerprint.ino === old.fingerprint.ino &&
        currentFingerprint.size > old.fingerprint.size &&
        old.completeOffset <= old.fingerprint.size
      ) {
        try {
          const boundaryMatches =
            boundaryHash(path, old.completeOffset) === old.boundaryHash;
          const historyMatches =
            !old.historyHash ||
            historyHash(path, old.completeOffset) === old.historyHash;
          if (boundaryMatches && historyMatches) {
            startOffset = old.completeOffset;
            initial = structuredClone(old.session);
            initial.allMessagesText = previousSearch[state.name] ?? "";
          }
        } catch {
          // A concurrent replacement requires a full parse.
        }
      }

      const parsed = await withFilePermit(() =>
        parseFile(path, startOffset, initial, () =>
          this.#waitForInteractiveReads(),
        ),
      );
      records[state.name] = {
        fingerprint: currentFingerprint,
        completeOffset: parsed.completeOffset,
        boundaryHash: boundaryHash(path, parsed.completeOffset),
        historyHash: historyHash(path, parsed.completeOffset),
        session: parsed.session,
      };
      changed = true;
    }

    if (previous && Object.keys(previous.records).length !== names.length)
      changed = true;
    const manifest: CatalogManifest = {
      version: CATALOG_VERSION,
      directory,
      searchGeneration: previous?.searchGeneration,
      records,
    };
    if (changed) this.#writeManifest(manifest);
    return { manifest, changed };
  }

  #cacheKey(directory: string) {
    return createHash("sha256").update(directory).digest("hex");
  }

  #manifestPath(directory: string) {
    return join(this.#cacheDirectory, `${this.#cacheKey(directory)}.json`);
  }

  #searchPath(directory: string, generation: string) {
    return join(
      this.#cacheDirectory,
      `${this.#cacheKey(directory)}.${generation}.search.json`,
    );
  }

  #readManifest(directory: string): CatalogManifest | undefined {
    try {
      const parsed = JSON.parse(
        readFileSync(this.#manifestPath(directory), "utf8"),
      );
      if (
        parsed?.version !== CATALOG_VERSION ||
        parsed.directory !== directory ||
        typeof parsed.searchGeneration !== "string" ||
        !isCatalogRecords(parsed.records) ||
        !existsSync(this.#searchPath(directory, parsed.searchGeneration))
      ) {
        return undefined;
      }
      const manifest = parsed as CatalogManifest;
      return this.#readSearch(manifest) ? manifest : undefined;
    } catch {
      return undefined;
    }
  }

  #readSearch(manifest: CatalogManifest): Record<string, string> | undefined {
    const generation = manifest.searchGeneration;
    if (!generation) return {};
    const key = `${manifest.directory}\0${generation}`;
    const cached = this.#searchCache.get(key);
    if (cached) return cached;
    try {
      const payload = JSON.parse(
        readFileSync(this.#searchPath(manifest.directory, generation), "utf8"),
      );
      if (
        payload?.version !== CATALOG_VERSION ||
        payload?.directory !== manifest.directory ||
        payload?.generation !== generation ||
        !isStringRecord(payload?.sessions)
      ) {
        return undefined;
      }
      const sessions: Record<string, string> = payload.sessions;
      this.#searchCache.set(key, sessions);
      return sessions;
    } catch {
      return undefined;
    }
  }

  #searchText(manifest: CatalogManifest, filename: string) {
    const search = this.#readSearch(manifest);
    if (search) return search[filename] ?? "";
    rmSync(this.#manifestPath(manifest.directory), { force: true });
    this.invalidate(manifest.directory);
    return "";
  }

  #writeAtomic(destination: string, content: string) {
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, content, { mode: 0o600 });
      const descriptor = openSync(temporary, "r");
      try {
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      renameSync(temporary, destination);
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  #writeManifest(manifest: CatalogManifest) {
    if (this.#closed) return;
    const previousGeneration = manifest.searchGeneration;
    const previousSearch = previousGeneration ? this.#readSearch(manifest) : {};
    if (!previousSearch) {
      rmSync(this.#manifestPath(manifest.directory), { force: true });
      this.invalidate(manifest.directory);
      return;
    }

    mkdirSync(this.#cacheDirectory, { recursive: true, mode: 0o700 });
    const destination = this.#manifestPath(manifest.directory);
    const lock = `${destination}.lock`;
    let lockDescriptor: number | undefined;
    try {
      lockDescriptor = openSync(lock, "wx", 0o600);
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      let stale = false;
      try {
        const owner = JSON.parse(readFileSync(lock, "utf8"));
        if (typeof owner?.pid === "number") {
          try {
            process.kill(owner.pid, 0);
          } catch (ownerError: any) {
            stale = ownerError?.code === "ESRCH";
          }
        } else {
          stale = Date.now() - statSync(lock).mtimeMs > 30_000;
        }
      } catch {
        try {
          stale = Date.now() - statSync(lock).mtimeMs > 30_000;
        } catch {
          stale = false;
        }
      }
      if (!stale) return;
      rmSync(lock, { force: true });
      lockDescriptor = openSync(lock, "wx", 0o600);
    }
    writeFileSync(
      lockDescriptor,
      JSON.stringify({ pid: process.pid, createdAt: Date.now() }),
    );
    fsyncSync(lockDescriptor);

    const search = Object.fromEntries(
      Object.entries(manifest.records).flatMap(([name, record]) =>
        record.session
          ? [
              [
                name,
                record.session.allMessagesText ?? previousSearch[name] ?? "",
              ],
            ]
          : [],
      ),
    );
    const searchNames = Object.keys(search);
    const previousNames = Object.keys(previousSearch);
    const searchChanged =
      !previousGeneration ||
      searchNames.length !== previousNames.length ||
      searchNames.some((name) => search[name] !== previousSearch[name]);
    const generation = searchChanged ? randomUUID() : previousGeneration;
    const persisted = structuredClone(manifest);
    persisted.searchGeneration = generation;
    for (const record of Object.values(persisted.records)) {
      if (record.session) delete record.session.allMessagesText;
    }

    try {
      if (searchChanged) {
        this.#writeAtomic(
          this.#searchPath(manifest.directory, generation),
          JSON.stringify({
            version: CATALOG_VERSION,
            directory: manifest.directory,
            generation,
            sessions: search,
          }),
        );
      }
      this.#writeAtomic(destination, JSON.stringify(persisted));
      manifest.searchGeneration = generation;
      this.#searchCache.set(`${manifest.directory}\0${generation}`, search);
      const directoryDescriptor = openSync(this.#cacheDirectory, "r");
      try {
        fsyncSync(directoryDescriptor);
      } finally {
        closeSync(directoryDescriptor);
      }
      const searchPrefix = `${this.#cacheKey(manifest.directory)}.`;
      const activeSearchName = `${searchPrefix}${generation}.search.json`;
      for (const name of readdirSync(this.#cacheDirectory)) {
        if (
          name.startsWith(searchPrefix) &&
          name.endsWith(".search.json") &&
          name !== activeSearchName
        ) {
          rmSync(join(this.#cacheDirectory, name), { force: true });
        }
      }
      const activeSearchKey = `${manifest.directory}\0${generation}`;
      for (const key of this.#searchCache.keys()) {
        if (
          key.startsWith(`${manifest.directory}\0`) &&
          key !== activeSearchKey
        ) {
          this.#searchCache.delete(key);
        }
      }
    } finally {
      if (lockDescriptor !== undefined) closeSync(lockDescriptor);
      rmSync(lock, { force: true });
    }
  }
}
