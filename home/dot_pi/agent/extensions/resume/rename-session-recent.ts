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
) {
  const { SessionManager } = req(join(distPath, "core", "session-manager.js"));
  const patchState = (SessionManager.prototype as any)[RENAME_PATCHED];

  if (!patchState) {
    (SessionManager.prototype as any)[RENAME_PATCHED] = true;

    const origAppend = SessionManager.prototype.appendSessionInfo;
    SessionManager.prototype.appendSessionInfo = function (name: string) {
      const id = origAppend.call(this, name);
      const sf = this.getSessionFile();
      if (sf) renameTimestamps.set(sf, Date.now());
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

    SessionManager.list = async function (
      cwd: string,
      sessionDir?: string,
      onProgress?: any,
    ) {
      // Fast path: check if all files in dir are cached and unchanged
      const dir = sessionDir ? sessionDir : getDefaultSessionDir(cwd);

      try {
        const dirEntries = await readdir(dir);
        const files = dirEntries
          .filter((f: string) => f.endsWith(".jsonl"))
          .map((f: string) => join(dir, f));

        let allCached = true;
        const cachedSessions: any[] = [];

        for (const filePath of files) {
          try {
            const st = statSync(filePath);
            const cached = sessionInfoCache.get(filePath);
            if (
              cached &&
              cached.mtimeMs === st.mtimeMs &&
              cached.size === st.size
            ) {
              cachedSessions.push(cached.info);
            } else {
              allCached = false;
              break;
            }
          } catch {
            allCached = false;
            break;
          }
        }

        if (allCached && files.length > 0) {
          onProgress?.(files.length, files.length);
          return bumpModified(cachedSessions);
        }
      } catch {
        // fall through to full load
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
      return bumped;
    };

    const origListAll = SessionManager.listAll;
    SessionManager.listAll = async function (onProgress?: any) {
      const sessions: any[] = await origListAll(onProgress);
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

export function patchRenameSelection(selector: any) {
  const originalConfirmRename = selector.confirmRename;
  if (typeof originalConfirmRename !== "function") return;

  selector.confirmRename = async function (this: any, value: string) {
    const target = this.renameTargetPath;
    await originalConfirmRename.call(this, value);
    if (target && this.sessionList?.filteredSessions) {
      const idx = this.sessionList.filteredSessions.findIndex(
        (s: any) => s.session.path === target,
      );
      if (idx !== -1) {
        this.sessionList.selectedIndex = idx;
        this.requestRender?.();
      }
    }
  };
}
