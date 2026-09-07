/** Adapts Pi's private session selector loaders to the durable resume catalog. */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  isDisplayableSessionEntry,
  type ResumeCatalog,
} from "./session-catalog";

const LOAD_PATCHED = Symbol.for("resume:catalog-selector-loader");
const PATCH_STATE = Symbol.for("resume:catalog-patch-state");
const SELECTOR_SUBSCRIPTIONS = Symbol.for("resume:catalog-subscriptions");
const INDEXING_MESSAGE = "Indexing full session history…";

type ResumeSessionScope = {
  cwd: string;
  sessionDir: string;
  usesDefaultSessionDir?: boolean;
};

type PatchState = {
  catalog?: ResumeCatalog;
  scope?: ResumeSessionScope;
  activeSessionManager?: any;
};

function state(): PatchState {
  const root = globalThis as any;
  return (root[PATCH_STATE] ??= {});
}

export function setResumeSessionScope(
  cwd: string | undefined,
  sessionDir: string | undefined,
  usesDefaultSessionDir?: boolean,
) {
  state().scope =
    cwd && sessionDir ? { cwd, sessionDir, usesDefaultSessionDir } : undefined;
}

export function setResumeActiveSessionManager(sessionManager: any) {
  state().activeSessionManager = sessionManager;
}

function parsedTime(value: unknown): number | undefined {
  const result = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(result) ? result : undefined;
}

function activeSessionInfo(existing?: any): any | undefined {
  const manager = state().activeSessionManager;
  const path = manager?.getSessionFile?.();
  const header = manager?.getHeader?.();
  if (!path || !header || typeof header.id !== "string") return undefined;

  const sessionName = manager.getSessionName?.() ?? existing?.name;
  const leaf = manager.getLeafEntry?.();
  const hasDisplayableEntry = Boolean(
    existing || sessionName || isDisplayableSessionEntry(leaf),
  );
  if (!hasDisplayableEntry) return undefined;

  const createdTime =
    parsedTime(header.timestamp) ??
    existing?.created?.getTime?.() ??
    Date.now();
  const modifiedTime = Math.max(
    createdTime,
    parsedTime(leaf?.timestamp) ?? 0,
    existing?.modified?.getTime?.() ?? 0,
  );

  return {
    path,
    id: header.id,
    cwd:
      typeof header.cwd === "string" ? header.cwd : (manager.getCwd?.() ?? ""),
    name: sessionName,
    parentSessionPath: header.parentSession,
    created: new Date(createdTime),
    modified: new Date(modifiedTime),
    messageCount: existing?.messageCount ?? 0,
    firstMessage: existing?.firstMessage ?? "(no messages)",
    allMessagesText: existing?.allMessagesText ?? "",
  };
}

function withActiveSession(sessions: any[]): any[] {
  const activePath = state().activeSessionManager?.getSessionFile?.();
  const existing = sessions.find((session) => session.path === activePath);
  const active = activeSessionInfo(existing);
  if (!active) return sessions;
  return [
    ...sessions.filter((session) => session.path !== active.path),
    active,
  ].sort((left, right) => right.modified.getTime() - left.modified.getTime());
}

function currentCatalogScope(scope: ResumeSessionScope) {
  return scope.usesDefaultSessionDir
    ? { sessionDir: scope.sessionDir }
    : { cwd: scope.cwd, sessionDir: scope.sessionDir };
}

export function primeResumeSessionCatalog() {
  const current = state();
  if (!current.catalog || !current.scope) return;
  void current.catalog
    .prime(currentCatalogScope(current.scope))
    .catch(() => {});
}

export function scheduleResumeSessionSync() {
  const current = state();
  if (!current.catalog || !current.scope) return;
  void current.catalog.open(currentCatalogScope(current.scope)).catch(() => {});
}

export function invalidateResumeSessionDir(
  directory: string,
  filename?: string,
) {
  state().catalog?.invalidate(directory, filename);
}

export function getResumeDefaultSessionDir(cwd: string) {
  const resolvedCwd = resolve(cwd);
  const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return join(getAgentDir(), "sessions", safePath);
}

function clearIndexingStatus(selector: any) {
  if (selector.header?.statusMessage?.message === INDEXING_MESSAGE) {
    selector.header.setStatusMessage(null);
  }
}

function selectorSubscriptions(selector: any) {
  return (selector[SELECTOR_SUBSCRIPTIONS] ??= {
    current: {},
    all: {},
  }) as { current: object; all: object };
}

export function releaseResumeSelector(selector: any) {
  const subscriptions = selector?.[SELECTOR_SUBSCRIPTIONS] as
    { current: object; all: object } | undefined;
  const catalog = state().catalog;
  if (!subscriptions || !catalog) return;
  catalog.unsubscribe(subscriptions.current);
  catalog.unsubscribe(subscriptions.all);
  catalog.endInteractiveRead(subscriptions.current);
  delete selector[SELECTOR_SUBSCRIPTIONS];
}

export function guardResumeSelection(selector: any) {
  const sessionList = selector?.sessionList;
  const originalSelect = sessionList?.onSelect;
  if (typeof originalSelect !== "function") return;
  sessionList.onSelect = (sessionPath: string) => {
    if (
      sessionList.isCurrentSessionPath?.(sessionPath) ||
      existsSync(sessionPath)
    ) {
      return originalSelect.call(sessionList, sessionPath);
    }
    selector.currentSessions = selector.currentSessions?.filter(
      (session: any) => session.path !== sessionPath,
    );
    selector.allSessions = selector.allSessions?.filter(
      (session: any) => session.path !== sessionPath,
    );
    const sessions =
      selector.scope === "all"
        ? (selector.allSessions ?? [])
        : (selector.currentSessions ?? []);
    sessionList.setSessions?.(sessions, selector.scope === "all");
    selector.header?.setStatusMessage?.(
      { type: "error", message: "Session no longer exists" },
      3000,
    );
    state().catalog?.invalidate(dirname(sessionPath));
    selector.requestRender?.();
  };
}

function publishSessions(
  selector: any,
  scope: "current" | "all",
  sessions: any[],
) {
  sessions = withActiveSession(sessions);
  if (scope === "current") selector.currentSessions = sessions;
  else selector.allSessions = sessions;
  if (selector.scope !== scope) return;
  clearIndexingStatus(selector);

  const sessionList =
    typeof selector.getSessionList === "function"
      ? selector.getSessionList()
      : selector.sessionList;
  const selectedPath =
    sessionList?.filteredSessions?.[sessionList.selectedIndex]?.session?.path;
  sessionList?.setSessions?.(sessions, scope === "all");
  const selectedIndex = sessionList?.filteredSessions?.findIndex(
    (node: any) => node.session?.path === selectedPath,
  );
  if (selectedIndex >= 0) sessionList.selectedIndex = selectedIndex;
  selector.requestRender?.();
}

export function installOptimizeStartup(
  SessionSelectorComponent: any,
  catalog: ResumeCatalog,
) {
  const patchState = state();
  patchState.catalog = catalog;

  const selectorProto = SessionSelectorComponent.prototype as any;
  if (selectorProto[LOAD_PATCHED]) return;

  const originalLoadCurrentSessions = selectorProto.loadCurrentSessions;
  selectorProto.loadCurrentSessions = function (this: any) {
    const current = state();
    const scope = current.scope;
    const activeCatalog = current.catalog;
    if (!scope || !activeCatalog) {
      return originalLoadCurrentSessions.call(this);
    }

    const subscriptions = selectorSubscriptions(this);
    const catalogLoader = (
      catalogScope: Parameters<ResumeCatalog["open"]>[0],
      target: "current" | "all",
      onProgress?: (loaded: number, total: number) => void,
      requireExact = false,
    ) => {
      const finish = (sessions: any[]) => {
        const visibleSessions = withActiveSession(sessions);
        if (this.scope === target) clearIndexingStatus(this);
        onProgress?.(visibleSessions.length, visibleSessions.length);
        return visibleSessions;
      };
      const open = requireExact ? activeCatalog.openExact : activeCatalog.open;
      return open
        .call(
          activeCatalog,
          { ...catalogScope, subscription: subscriptions[target] },
          (sessions) => {
            if (state().catalog === activeCatalog) {
              publishSessions(this, target, sessions);
            }
          },
        )
        .then((sessions) => {
          const provisional = activeCatalog.isProvisional(sessions);
          const visibleSessions = finish(sessions);
          if (provisional && state().catalog === activeCatalog) {
            publishSessions(this, target, sessions);
          }
          return visibleSessions;
        });
    };

    let requireInitialExact = false;
    this.currentSessionsLoader = (
      onProgress?: (loaded: number, total: number) => void,
    ) =>
      catalogLoader(
        currentCatalogScope(scope),
        "current",
        onProgress,
        requireInitialExact,
      );
    this.allSessionsLoader = (
      onProgress?: (loaded: number, total: number) => void,
    ) =>
      catalogLoader(
        scope.usesDefaultSessionDir
          ? {
              sessionDir: join(getAgentDir(), "sessions"),
              allDirectories: true,
            }
          : { sessionDir: scope.sessionDir },
        "all",
        onProgress,
        requireInitialExact,
      );

    const catalogScope = currentCatalogScope(scope);
    const cached = activeCatalog.peek(catalogScope);
    requireInitialExact = !activeCatalog.hasPersistedCatalog(catalogScope);
    if (requireInitialExact) {
      this.currentSessions = [];
      this.currentLoading = false;
      this.header?.setScope?.("current");
      this.header?.setLoading?.(false);
      this.header?.setStatusMessage?.({
        type: "info",
        message: INDEXING_MESSAGE,
      });
      this.sessionList?.setSessions?.([], false);
      void catalogLoader(
        catalogScope,
        "current",
        undefined,
        requireInitialExact,
      )
        .then((sessions) => {
          if (state().catalog === activeCatalog) {
            publishSessions(this, "current", sessions);
          }
        })
        .catch((error) => {
          if (state().catalog !== activeCatalog || this.scope !== "current") {
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          this.header?.setStatusMessage?.({
            type: "error",
            message: `Failed to load sessions: ${message}`,
          });
          this.requestRender?.();
        });
      return;
    }

    activeCatalog.beginInteractiveRead(subscriptions.current);
    const immediate = withActiveSession(cached ?? []);
    this.currentSessions = immediate;
    this.currentLoading = false;
    this.header?.setScope?.("current");
    this.header?.setLoading?.(false);
    this.sessionList?.setSessions?.(immediate, false);
    clearIndexingStatus(this);
    void catalogLoader(catalogScope, "current").catch(() => {});
  };

  selectorProto[LOAD_PATCHED] = true;
}
