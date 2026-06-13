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

type ResumeSessionScope = {
  cwd: string | undefined;
  sessionDir: string | undefined;
  usesDefaultSessionDir?: boolean;
  includeAll?: boolean;
};

let scheduleSyncImpl = (_scope: ResumeSessionScope) => {};

export function setResumeSessionScope(
  cwd: string | undefined,
  sessionDir: string | undefined,
) {
  _resumeCwd = cwd;
  _resumeSessionDir = sessionDir;
}

export function scheduleResumeSessionSync(scope: ResumeSessionScope) {
  scheduleSyncImpl(scope);
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
  const { getDefaultSessionDir, SessionManager } = req(
    join(distPath, "core", "session-manager.js"),
  );
  const syncInFlight = new Set<string>();

  const scheduleOne = (key: string, load: () => Promise<unknown>) => {
    if (syncInFlight.has(key)) return;
    syncInFlight.add(key);
    setImmediate(() => {
      void Promise.resolve()
        .then(load)
        .catch(() => {})
        .finally(() => syncInFlight.delete(key));
    });
  };

  scheduleSyncImpl = (scope: ResumeSessionScope) => {
    const cwd = scope.cwd;
    const sessionDir = scope.sessionDir;
    if (!cwd) return;

    const dirKey = `${cwd}\0${sessionDir ?? ""}`;
    scheduleOne(`current\0${dirKey}`, () =>
      SessionManager.list(cwd, sessionDir),
    );

    if (!scope.includeAll) return;
    if (scope.usesDefaultSessionDir || !sessionDir) {
      scheduleOne("all\0default", () => SessionManager.listAll());
    } else {
      scheduleOne(`all\0${sessionDir}`, () =>
        SessionManager.listAll(sessionDir),
      );
    }
  };

  if (selectorProto[LOAD_PATCHED]) return;

  const originalLoadCurrentSessions = selectorProto.loadCurrentSessions;

  selectorProto.loadCurrentSessions = function (this: any) {
    // Fast path: if we have cached SessionInfo for files in this dir,
    // show them immediately. Refresh cache in the background for next open,
    // but do not mutate the visible selector after it renders.
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
            scheduleResumeSessionSync({
              cwd: _resumeCwd,
              sessionDir: _resumeSessionDir,
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
