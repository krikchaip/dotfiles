/**
 * Makes /resume open instantly after session metadata is cached.
 *
 * Shows cached sessions immediately, refreshes the list in the background, and
 * preserves sane ordering/selection without loading-progress flicker.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

const LOAD_PATCHED = "__resumeSnapPatched";

type SessionInfoCache = Map<
  string,
  { mtimeMs: number; size: number; info: any }
>;

// Module-level vars set during showSessionSelector so the sync cache path
// in loadCurrentSessions can locate the session directory without async.
let _resumeCwd: string | undefined;
let _resumeSessionDir: string | undefined;

export function setResumeSessionScope(
  cwd: string | undefined,
  sessionDir: string | undefined,
) {
  _resumeCwd = cwd;
  _resumeSessionDir = sessionDir;
}

export function installOptimizeStartup(
  req: NodeRequire,
  distPath: string,
  sessionInfoCache: SessionInfoCache,
) {
  const { SessionSelectorComponent } = req(
    join(distPath, "modes", "interactive", "components", "session-selector.js"),
  );
  const selectorProto = SessionSelectorComponent.prototype as any;

  if (selectorProto[LOAD_PATCHED]) return;

  const originalLoadCurrentSessions = selectorProto.loadCurrentSessions;
  const { getDefaultSessionDir } = req(
    join(distPath, "core", "session-manager.js"),
  );

  selectorProto.loadCurrentSessions = function (this: any) {
    // Fast path: if we have cached SessionInfo for files in this dir,
    // show them immediately (even if slightly stale for active session).
    // Then kick off a background refresh to correct any stale entries.
    if (_resumeCwd) {
      try {
        const dir = _resumeSessionDir ?? getDefaultSessionDir(_resumeCwd);
        const dirEntries: string[] = readdirSync(dir);
        const files = dirEntries
          .filter((f: string) => f.endsWith(".jsonl"))
          .map((f: string) => join(dir, f));

        if (files.length > 0) {
          const cachedSessions: any[] = [];
          let hitCount = 0;

          for (const filePath of files) {
            const cached = sessionInfoCache.get(filePath);
            if (cached?.info) {
              cachedSessions.push(cached.info);
              hitCount++;
            }
          }

          // Show cached results if we have most files cached (>50%)
          if (hitCount > files.length / 2) {
            cachedSessions.sort(
              (a, b) => b.modified.getTime() - a.modified.getTime(),
            );
            this.currentSessions = cachedSessions;
            this.currentLoading = false;
            this.header?.setLoading(false);
            this.sessionList?.setSessions(cachedSessions, false);

            // Position cursor on current session
            const sl = this.sessionList;
            if (sl?.currentSessionCanonicalPath && sl.filteredSessions) {
              const idx = sl.filteredSessions.findIndex((node: any) =>
                sl.isCurrentSessionPath(node.session.path),
              );
              if (idx >= 0) sl.selectedIndex = idx;
            }

            this.requestRender?.();

            // Background refresh to update stale entries silently.
            // Suppress progress/loading indicators and preserve cursor.
            setImmediate(() => {
              const header = this.header;
              const origSetLoading = header?.setLoading;
              const origSetProgress = header?.setProgress;
              if (header) {
                header.setLoading = () => {};
                header.setProgress = () => {};
              }
              const origRequestRender = this.requestRender;
              this.requestRender = () => {};

              const origSetSessions = this.sessionList?.setSessions;
              if (this.sessionList) {
                const sessionList = this.sessionList;
                const hadCurrentSession =
                  sessionList.currentSessionCanonicalPath &&
                  sessionList.filteredSessions?.some((node: any) =>
                    sessionList.isCurrentSessionPath(node.session.path),
                  );
                sessionList.setSessions = function (
                  sessions: any,
                  showCwd: any,
                ) {
                  const prevPath =
                    sessionList.filteredSessions?.[sessionList.selectedIndex]
                      ?.session?.path;
                  origSetSessions.call(sessionList, sessions, showCwd);
                  if (!hadCurrentSession) {
                    // New session appeared — set cursor to top
                    sessionList.selectedIndex = 0;
                  } else if (prevPath && sessionList.filteredSessions) {
                    const newIdx = sessionList.filteredSessions.findIndex(
                      (node: any) => node.session.path === prevPath,
                    );
                    if (newIdx >= 0) sessionList.selectedIndex = newIdx;
                  }
                  sessionList.setSessions = origSetSessions;
                };
              }

              const origLoadScope = this.loadScope;
              this.loadScope = async function (
                this: any,
                scope: string,
                reason: string,
              ) {
                await origLoadScope.call(this, scope, reason);
                if (header) {
                  header.setLoading = origSetLoading;
                  header.setProgress = origSetProgress;
                  header.setLoading(false);
                }
                this.requestRender = origRequestRender;
                delete this.loadScope;
                this.requestRender?.();
              };

              void originalLoadCurrentSessions.call(this);
            });
            return;
          }
        }
      } catch {
        // fall through to normal async load
      }
    }

    this.currentLoading = true;
    this.header?.setLoading(true);
    this.requestRender?.();
    setImmediate(() => {
      void originalLoadCurrentSessions.call(this);
    });
  };

  selectorProto[LOAD_PATCHED] = true;
}
