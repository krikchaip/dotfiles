/**
 * Patch rename-bump: session rename → bump modified timestamp → session moves to top
 *
 * When a session is renamed (via /name or /resume Ctrl+R), updates its
 * modified timestamp so it surfaces to the top of the /resume picker,
 * and auto-selects the renamed session in the list.
 *
 * Mirrors opencode behavior: rename = activity = session jumps to top.
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { closeSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PATCHED = "__renameBumpPatched";
const PATCH_VERSION = 3;
const SESSION_INFO_TAIL_BYTES = 256 * 1024;
const renameTimestamps = new Map<string, number>();
const sessionInfoTimestampCache = new Map<
  string,
  { mtimeMs: number; size: number; timestamp: number | undefined }
>();

function latestSessionInfoTimestamp(sessionPath: string) {
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

export default function (_pi: ExtensionAPI) {
  const req = createRequire(import.meta.url || __filename);
  const cliPath = realpathSync(process.argv[1]);
  const distPath = dirname(cliPath);

  // ── Patch SessionManager ──

  const { SessionManager } = req(join(distPath, "core", "session-manager.js"));
  const patchState = (SessionManager.prototype as any)[PATCHED];
  if (!patchState) {
    (SessionManager.prototype as any)[PATCHED] = { version: PATCH_VERSION };

    // Track rename — intercept appendSessionInfo to record timestamp
    const origAppend = SessionManager.prototype.appendSessionInfo;
    SessionManager.prototype.appendSessionInfo = function (name: string) {
      const id = origAppend.call(this, name);
      const sf = this.getSessionFile();
      if (sf) renameTimestamps.set(sf, Date.now());
      return id;
    };

    // Helper: bump modified from persisted session_info timestamps.
    // In-memory timestamp covers same-process rename immediately; persisted
    // JSONL timestamp covers restart/reopen.
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
    SessionManager.list = async function (
      cwd: string,
      sessionDir?: string,
      onProgress?: any,
    ) {
      return bumpModified(await origList(cwd, sessionDir, onProgress));
    };

    const origListAll = SessionManager.listAll;
    SessionManager.listAll = async function (onProgress?: any) {
      return bumpModified(await origListAll(onProgress));
    };
  } else if (patchState.version !== PATCH_VERSION) {
    patchState.version = PATCH_VERSION;
  }

  // ── Patch SessionSelectorComponent (interactive mode) ──
  // Auto-select the renamed session after reload

  try {
    const { SessionSelectorComponent } = req(
      join(
        distPath,
        "modes",
        "interactive",
        "components",
        "session-selector.js",
      ),
    );

    const selectorState = (SessionSelectorComponent.prototype as any)[PATCHED];
    if (!selectorState) {
      (SessionSelectorComponent.prototype as any)[PATCHED] = {
        version: PATCH_VERSION,
      };

      const origConfirmRename =
        SessionSelectorComponent.prototype.confirmRename;
      SessionSelectorComponent.prototype.confirmRename = async function (
        value: string,
      ) {
        const target = this.renameTargetPath; // capture before orig clears it
        await origConfirmRename.call(this, value);
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
    } else if (selectorState.version !== PATCH_VERSION) {
      selectorState.version = PATCH_VERSION;
    }
  } catch {
    // Not interactive mode (print/rpc) — skip
  }
}
