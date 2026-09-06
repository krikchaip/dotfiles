/** Keeps persisted rename metadata and selector selection in sync. */

import type { ResumeCatalog } from "./session-catalog";

const RENAME_PATCHED = Symbol.for("resume:rename-catalog-patch");

type RenamePatchState = {
  catalog: ResumeCatalog;
  originalAppend: (name: string) => string;
};

export function applyRenameSessionRecent(
  SessionManager: any,
  catalog: ResumeCatalog,
) {
  const prototype = SessionManager.prototype as any;
  const existing = prototype[RENAME_PATCHED] as RenamePatchState | undefined;
  if (existing) {
    existing.catalog = catalog;
    return SessionManager;
  }

  const patchState: RenamePatchState = {
    catalog,
    originalAppend: prototype.appendSessionInfo,
  };
  prototype[RENAME_PATCHED] = patchState;
  prototype.appendSessionInfo = function (name: string) {
    const id = patchState.originalAppend.call(this, name);
    const sessionPath = this.getSessionFile?.();
    const persistedName = this.getSessionName?.() ?? name;
    if (sessionPath)
      patchState.catalog.recordRename(sessionPath, persistedName);
    return id;
  };
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

export function patchRenameSelection(selector: any, interactiveMode: any) {
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
      const sessionList = getSessionList(this);
      if (
        sessionList?.isCurrentSessionPath?.(target) &&
        interactiveMode.sessionManager?.appendSessionInfo
      ) {
        interactiveMode.sessionManager.appendSessionInfo(next);
        interactiveMode.ui?.requestRender?.();
      } else {
        await renameSession(target, next);
      }
      updateSelectorSessionName(this, target, next);
      refreshSelectorSessions(this, target);
    } finally {
      this.exitRenameMode();
    }
  };
}
