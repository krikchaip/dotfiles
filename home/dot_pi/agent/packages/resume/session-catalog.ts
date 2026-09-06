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

const CATALOG_VERSION = 1;
const BOUNDARY_HASH_BYTES = 4096;
const HISTORY_HASH_BYTES = 1024;
const HISTORY_HASH_SAMPLES = 16;
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
      firstMessage: "",
      allMessagesText: "",
    };
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
): Promise<{ completeOffset: number; session: ReducedSession | null }> {
  let reduced: ReducedSession | null | undefined = initial;
  let pending: Buffer[] = [];
  let pendingLength = 0;
  let completeOffset = startOffset;
  const stream = createReadStream(path, { start: startOffset });

  for await (const value of stream) {
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
  if (!session) return undefined;
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
  readonly #snapshots = new Map<
    string,
    {
      manifest: CatalogManifest;
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

  peek(scope: ResumeCatalogScope): any[] | undefined {
    if (this.#closed || scope.allDirectories) return undefined;
    const snapshot = this.#snapshots.get(resolve(scope.sessionDir));
    if (!snapshot || snapshot.provisional || snapshot.needsFullRepair) {
      return undefined;
    }
    return this.#sessions(snapshot.manifest, scope.cwd);
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
    const provisional = await this.#bootstrap(directory);
    if (this.#closed) return;
    this.#snapshots.set(directory, {
      manifest: provisional,
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
    await this.prime(scope);
    const snapshot = this.#snapshots.get(directory);
    if (!snapshot) return [];
    if (snapshot.needsFullRepair) this.#scheduleRepair(directory);
    return this.#sessions(snapshot.manifest, scope.cwd, snapshot.provisional);
  }

  unsubscribe(subscription: object) {
    for (const listeners of this.#listeners.values()) {
      listeners.delete(subscription);
    }
  }

  async #openAll(
    scope: ResumeCatalogScope,
    onUpdate?: (sessions: any[]) => void,
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
      const sessions = await this.open(
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

  async #bootstrap(directory: string): Promise<CatalogManifest> {
    return { version: CATALOG_VERSION, directory, records: {} };
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
        parseFile(path, startOffset, initial),
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
      return parsed?.version === CATALOG_VERSION &&
        parsed.directory === directory &&
        typeof parsed.searchGeneration === "string" &&
        isCatalogRecords(parsed.records) &&
        existsSync(this.#searchPath(directory, parsed.searchGeneration))
        ? (parsed as CatalogManifest)
        : undefined;
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
