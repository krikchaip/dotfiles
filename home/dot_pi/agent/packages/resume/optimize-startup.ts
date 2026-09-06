/** Adapts Pi's private session selector loaders to the durable resume catalog. */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ResumeCatalog } from "./session-catalog";

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

function entryText(entry: any): string {
  const content = entry?.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part: any) => part?.type === "text" && typeof part.text === "string",
    )
    .map((part: any) => part.text)
    .join("\n");
}

function activeSessionInfo(): any | undefined {
  const manager = state().activeSessionManager;
  const path = manager?.getSessionFile?.();
  const header = manager?.getHeader?.();
  if (!path || !header || typeof header.id !== "string") return undefined;

  const entries = manager.getEntries?.() ?? [];
  const messages = entries.filter((entry: any) => entry?.type === "message");
  const searchable = messages.filter(
    (entry: any) =>
      entry.message?.role === "user" || entry.message?.role === "assistant",
  );
  const firstMessage = searchable.find(
    (entry: any) => entry.message?.role === "user" && entryText(entry),
  );
  const timestamps = [header, ...entries]
    .map((entry: any) => Date.parse(entry?.timestamp ?? ""))
    .filter(Number.isFinite);
  const created = new Date(header.timestamp);

  return {
    path,
    id: header.id,
    cwd:
      typeof header.cwd === "string" ? header.cwd : (manager.getCwd?.() ?? ""),
    name: manager.getSessionName?.(),
    parentSessionPath: header.parentSession,
    created,
    modified: new Date(
      timestamps.length ? Math.max(...timestamps) : created.getTime(),
    ),
    messageCount: messages.length,
    firstMessage: firstMessage ? entryText(firstMessage) : "(no messages)",
    allMessagesText: searchable.map(entryText).filter(Boolean).join(" "),
  };
}

function withActiveSession(sessions: any[]): any[] {
  const active = activeSessionInfo();
  if (!active) return sessions;
  const existing = sessions.find((session) => session.path === active.path);
  return [
    ...sessions.filter((session) => session.path !== active.path),
    { ...existing, ...active },
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

function setIndexingStatus(
  selector: any,
  sessions: any[],
  provisional = sessions.some((session) => session.provisional),
) {
  if (provisional) {
    selector.header?.setStatusMessage?.({
      type: "info",
      message: INDEXING_MESSAGE,
    });
  } else if (selector.header?.statusMessage?.message === INDEXING_MESSAGE) {
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
  setIndexingStatus(selector, sessions);
  if (scope === "current") selector.currentSessions = sessions;
  else selector.allSessions = sessions;
  if (selector.scope !== scope) return;

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
    ) =>
      activeCatalog
        .open(
          { ...catalogScope, subscription: subscriptions[target] },
          (sessions) => {
            if (state().catalog === activeCatalog) {
              publishSessions(this, target, sessions);
            }
          },
        )
        .then((sessions) => {
          const provisional = activeCatalog.isProvisional(sessions);
          const visibleSessions = withActiveSession(sessions);
          setIndexingStatus(this, visibleSessions, provisional);
          onProgress?.(
            provisional ? 0 : visibleSessions.length,
            visibleSessions.length,
          );
          return provisional ? [] : visibleSessions;
        });

    this.currentSessionsLoader = (
      onProgress?: (loaded: number, total: number) => void,
    ) => catalogLoader(currentCatalogScope(scope), "current", onProgress);
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
      );

    const catalogScope = currentCatalogScope(scope);
    const cached = activeCatalog.peek(catalogScope);
    if (!cached) return originalLoadCurrentSessions.call(this);
    const immediate = withActiveSession(cached);

    this.currentSessions = immediate;
    this.currentLoading = false;
    this.header?.setScope?.("current");
    this.header?.setLoading?.(false);
    this.sessionList?.setSessions?.(immediate, false);
    setIndexingStatus(this, immediate, false);
    void catalogLoader(catalogScope, "current").catch(() => {});
  };

  selectorProto[LOAD_PATCHED] = true;
}
