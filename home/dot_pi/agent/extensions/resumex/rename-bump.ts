/**
 * Rename timestamp tracking for resumex picker
 *
 * When a session is renamed, its modified timestamp gets bumped so it
 * surfaces to the top of the picker list — same behavior as opencode's
 * rename = activity = session jumps to top.
 *
 * Two timestamp sources:
 *   1. In-memory Map — covers same-process renames immediately
 *   2. Persisted session_info JSONL entries — covers restart/reopen
 */

import { closeSync, openSync, readSync, statSync } from "node:fs";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";

const SESSION_INFO_TAIL_BYTES = 256 * 1024;
const renameTimestamps = new Map<string, number>();
const sessionInfoTimestampCache = new Map<
  string,
  { mtimeMs: number; size: number; timestamp: number | undefined }
>();

export function trackRename(sessionPath: string): void {
  renameTimestamps.set(sessionPath, Date.now());
}

/**
 * Read the timestamp of the latest session_info JSONL entry from
 * the tail of a session file. Uses a stat-based cache to avoid
 * re-reading unchanged files.
 */
function latestSessionInfoTimestamp(sessionPath: string): number | undefined {
  try {
    const st = statSync(sessionPath);
    const cached = sessionInfoTimestampCache.get(sessionPath);
    if (cached?.mtimeMs === st.mtimeMs && cached.size === st.size) {
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
      if (start > 0) lines.shift(); // drop partial first line

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

/**
 * Apply rename timestamp bumps to a session list.
 *
 * Uses dual-source timestamps:
 *   - In-memory renameTimestamps for same-process renames
 *   - Persisted session_info JSONL timestamps for cross-process/restart
 *     (only for sessions that have a name, to avoid unnecessary IO)
 *
 * Returns new sorted array if any bumps were applied, original otherwise.
 */
export function bumpModifiedByRenames(sessions: SessionInfo[]): SessionInfo[] {
  let modified = false;

  const result = sessions.map((s) => {
    const t = Math.max(
      renameTimestamps.get(s.path) ?? 0,
      s.name ? (latestSessionInfoTimestamp(s.path) ?? 0) : 0,
    );
    if (t && t > s.modified.getTime()) {
      modified = true;
      return { ...s, modified: new Date(t) };
    }
    return s;
  });

  if (modified) {
    result.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  }

  return result;
}
