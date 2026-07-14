/**
 * Makes renamed sessions behave like recently modified sessions.
 *
 * Records rename time, reads the latest persisted session_info timestamp, bumps
 * session list ordering, and keeps selection on the renamed item after rename.
 */

import { closeSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

const RENAME_PATCHED = "__renameBumpPatched";

/** Bytes read from tail of session file when scanning for session_info name. */
const SESSION_INFO_TAIL_BYTES = 256 * 1024;

const renameTimestamps = new Map<string, number>();
const sessionInfoTimestampCache = new Map<
  string,
  { mtimeMs: number; size: number; timestamp: number | undefined }
>();

type SessionInfoCache = Map<
  string,
  { mtimeMs: number; size: number; info: any }
>;

type SessionFileState = Map<string, { mtimeMs: number; size: number }>;
type SessionListSnapshot = {
  files: SessionFileState;
  sessions: any[];
};

function updateCachedSessionInfo(
  sessionInfoCache: SessionInfoCache,
  sessionPath: string,
  name: string,
  timestamp: number,
) {
  try {
    const st = statSync(sessionPath);
    const cached = sessionInfoCache.get(sessionPath);
    if (!cached?.info) return;

    sessionInfoCache.set(sessionPath, {
      mtimeMs: st.mtimeMs,
      size: st.size,
      info: {
        ...cached.info,
        name: name.trim() || undefined,
        modified: new Date(
          Math.max(timestamp, cached.info.modified?.getTime?.() ?? 0),
        ),
      },
    });
  } catch {
    // ignore
  }
}

function latestSessionInfoTimestamp(sessionPath: string) {
  try {
    const st = statSync(sessionPath);
    const cached = sessionInfoTimestampCache.get(sessionPath);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      return cached.timestamp;
    }

    let timestamp: number | undefined;
    const fd = openSync(sessionPath, "r");
    try {
      const length = Math.min(st.size, SESSION_INFO_TAIL_BYTES);
      const start = Math.max(0, st.size - length);
      const buffer = Buffer.alloc(length);
      const bytesRead = readSync(fd, buffer, 0, length, start);
      const content = buffer.toString("utf8", 0, bytesRead);
      const lines = content.split("\n");
      if (start > 0) lines.shift();

      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line.includes("session_info")) continue;
        try {
          const entry = JSON.parse(line);
          if (entry?.type !== "session_info") continue;
          const t = Date.parse(entry.timestamp);
          if (!Number.isNaN(t)) {
            timestamp = t;
            break;
          }
        } catch {
          // Ignore malformed JSONL lines, matching core session loader behavior.
        }
      }
    } finally {
      closeSync(fd);
    }

    sessionInfoTimestampCache.set(sessionPath, {
      mtimeMs: st.mtimeMs,
      size: st.size,
      timestamp,
    });
    return timestamp;
  } catch {
    return undefined;
  }
}

export function applyRenameSessionRecent(
  req: NodeRequire,
  distPath: string,
  sessionInfoCache: SessionInfoCache,
  onSessionInfoAppended?: (sessionManager: any) => void,
) {
  const { SessionManager } = req(join(distPath, "core", "session-manager.js"));
  const patchState = (SessionManager.prototype as any)[RENAME_PATCHED];

  if (!patchState) {
    (SessionManager.prototype as any)[RENAME_PATCHED] = true;

    const origAppend = SessionManager.prototype.appendSessionInfo;
    SessionManager.prototype.appendSessionInfo = function (name: string) {
      const id = origAppend.call(this, name);
      const sf = this.getSessionFile();
      if (sf) {
        const t = Date.now();
        renameTimestamps.set(sf, t);
        updateCachedSessionInfo(sessionInfoCache, sf, name, t);
        onSessionInfoAppended?.(this);
      }
      return id;
    };

    const bumpModified = (sessions: any[]) =>
      sessions
        .map((s) => {
          const t = Math.max(
            renameTimestamps.get(s.path) ?? 0,
            s.name ? (latestSessionInfoTimestamp(s.path) ?? 0) : 0,
          );
          return t && t > s.modified.getTime()
            ? { ...s, modified: new Date(t) }
            : s;
        })
        .sort((a, b) => b.modified.getTime() - a.modified.getTime());

    const origList = SessionManager.list;
    const { getDefaultSessionDir } = req(
      join(distPath, "core", "session-manager.js"),
    );
    const { readdir } = req("node:fs/promises");
    const sessionListSnapshots = new Map<string, SessionListSnapshot>();
    const sessionListInFlight = new Map<string, Promise<any[]>>();

    const readSessionFileState = async (
      dir: string,
    ): Promise<SessionFileState | undefined> => {
      try {
        const dirEntries: string[] = await readdir(dir);
        const files = new Map<string, { mtimeMs: number; size: number }>();
        for (const name of dirEntries) {
          if (!name.endsWith(".jsonl")) continue;
          const filePath = join(dir, name);
          const st = statSync(filePath);
          files.set(filePath, { mtimeMs: st.mtimeMs, size: st.size });
        }
        return files;
      } catch {
        return undefined;
      }
    };

    const sameSessionFileState = (
      left: SessionFileState | undefined,
      right: SessionFileState | undefined,
    ) => {
      if (!left || !right || left.size !== right.size) return false;
      for (const [filePath, stat] of left) {
        const other = right.get(filePath);
        if (
          !other ||
          other.mtimeMs !== stat.mtimeMs ||
          other.size !== stat.size
        ) {
          return false;
        }
      }
      return true;
    };

    SessionManager.list = async function (
      cwd: string,
      sessionDir?: string,
      onProgress?: any,
    ) {
      const dir = sessionDir ? sessionDir : getDefaultSessionDir(cwd);
      const cacheKey = `${cwd}\0${dir}`;
      const pending = sessionListInFlight.get(cacheKey);
      if (pending) return pending;

      const load = (async () => {
        const filesBefore = await readSessionFileState(dir);
        const snapshot = sessionListSnapshots.get(cacheKey);
        if (snapshot && sameSessionFileState(snapshot.files, filesBefore)) {
          onProgress?.(filesBefore?.size ?? 0, filesBefore?.size ?? 0);
          return bumpModified(snapshot.sessions);
        }

        const sessions: any[] = await origList(cwd, sessionDir, onProgress);
        const bumped = bumpModified(sessions);
        for (const s of bumped) {
          if (!s?.path) continue;
          try {
            const st = statSync(s.path);
            sessionInfoCache.set(s.path, {
              mtimeMs: st.mtimeMs,
              size: st.size,
              info: s,
            });
          } catch {
            // ignore
          }
        }

        const filesAfter = await readSessionFileState(dir);
        if (sameSessionFileState(filesBefore, filesAfter) && filesAfter) {
          sessionListSnapshots.set(cacheKey, {
            files: filesAfter,
            sessions: bumped,
          });
        }
        return bumped;
      })().finally(() => {
        sessionListInFlight.delete(cacheKey);
      });
      sessionListInFlight.set(cacheKey, load);
      return load;
    };

    const origListAll = SessionManager.listAll;
    SessionManager.listAll = async function (
      sessionDirOrOnProgress?: any,
      onProgress?: any,
    ) {
      const sessions: any[] = await origListAll(
        sessionDirOrOnProgress,
        onProgress,
      );
      const bumped = bumpModified(sessions);
      for (const s of bumped) {
        if (!s?.path) continue;
        try {
          const st = statSync(s.path);
          sessionInfoCache.set(s.path, {
            mtimeMs: st.mtimeMs,
            size: st.size,
            info: s,
          });
        } catch {
          // ignore
        }
      }
      return bumped;
    };
  }

  return SessionManager;
}

function getSessionList(selector: any) {
  return typeof selector.getSessionList === "function"
    ? selector.getSessionList()
    : selector.sessionList;
}

function updateSelectorSessionName(
  selector: any,
  target: string,
  name: string,
) {
  const seen = new Set<any>();
  const update = (session: any) => {
    if (!session || session.path !== target || seen.has(session)) return;
    seen.add(session);
    session.name = name;
    session.modified = new Date(
      Math.max(Date.now(), session.modified?.getTime?.() ?? 0),
    );
  };

  selector.currentSessions?.forEach(update);
  selector.allSessions?.forEach(update);
  selector.sessionList?.allSessions?.forEach(update);
  selector.sessionList?.filteredSessions?.forEach((node: any) =>
    update(node.session),
  );
}

function refreshSelectorSessions(selector: any, target: string) {
  const sessionList = getSessionList(selector);
  if (!sessionList) return;

  const showCwd = selector.scope === "all";
  const sessions = showCwd
    ? (selector.allSessions ?? [])
    : (selector.currentSessions ?? []);

  sessionList.setSessions?.(sessions, showCwd);
  const idx = sessionList.filteredSessions?.findIndex(
    (node: any) => node.session?.path === target,
  );
  if (idx >= 0) sessionList.selectedIndex = idx;
}

export function patchRenameSelection(selector: any) {
  if (typeof selector.confirmRename !== "function") return;

  selector.confirmRename = async function (this: any, value: string) {
    const next = value.trim();
    if (!next) return;

    const target = this.renameTargetPath;
    if (!target) {
      this.exitRenameMode();
      return;
    }

    const renameSession = this.renameSession;
    if (!renameSession) {
      this.exitRenameMode();
      return;
    }

    try {
      await renameSession(target, next);
      updateSelectorSessionName(this, target, next);
      refreshSelectorSessions(this, target);
    } finally {
      this.exitRenameMode();
    }
  };
}
