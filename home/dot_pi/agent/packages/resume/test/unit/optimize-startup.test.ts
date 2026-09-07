import { afterEach, describe, expect, test } from "bun:test";
import {
  installOptimizeStartup,
  releaseResumeSelector,
  setResumeActiveSessionManager,
  setResumeSessionScope,
} from "../../optimize-startup.ts";

afterEach(() => {
  setResumeActiveSessionManager(undefined);
  setResumeSessionScope(undefined, undefined);
});

describe("resume selector cold startup", () => {
  const activeSession = {
    getSessionFile: () => "/tmp/sessions/active.jsonl",
    getHeader: () => ({
      type: "session",
      id: "79000000-0000-7000-8000-000000000001",
      timestamp: "2026-09-07T00:00:00.000Z",
      cwd: "/tmp/project",
    }),
    getEntries: () => {
      throw new Error("active transcript must not be scanned synchronously");
    },
    getLeafEntry: () => undefined,
    getCwd: () => "/tmp/project",
    getSessionName: () => undefined,
  };
  const existing = {
    path: "/tmp/sessions/existing.jsonl",
    id: "79000000-0000-7000-8000-000000000002",
    cwd: "/tmp/project",
    created: new Date("2026-09-06T00:00:00.000Z"),
    modified: new Date("2026-09-06T00:00:00.000Z"),
    messageCount: 0,
    firstMessage: "Existing session",
  };

  function selectorClass() {
    return class Selector {
      currentSessions: any[] | undefined;
      currentLoading = true;
      scope = "current";
      originalLoadCalls = 0;
      indexingStatus: any;
      header = {
        statusMessage: undefined as any,
        setScope: () => undefined,
        setLoading: () => undefined,
        setStatusMessage: (status: any) => {
          this.indexingStatus = status;
          this.header.statusMessage = status;
        },
      };
      sessionList = {
        sessions: [] as any[],
        setSessions: (sessions: any[]) => {
          this.sessionList.sessions = sessions;
        },
      };

      loadCurrentSessions() {
        this.originalLoadCalls++;
      }
    };
  }

  test("shows no rows while an absent catalog indexes", async () => {
    const provisional = [{ ...existing, provisional: true }];
    const exact = [{ ...existing }];
    let resolveExact!: (sessions: any[]) => void;
    let interactiveReads = 0;
    const catalog = {
      peek: () => provisional,
      hasPersistedCatalog: () => false,
      open: async () => provisional,
      openExact: () =>
        new Promise<any[]>((resolve) => {
          resolveExact = resolve;
        }),
      isProvisional: (sessions: any[]) => sessions === provisional,
      beginInteractiveRead: () => interactiveReads++,
      endInteractiveRead: () => interactiveReads--,
      unsubscribe: () => undefined,
    };
    const Selector = selectorClass();
    installOptimizeStartup(Selector, catalog as any);
    setResumeSessionScope("/tmp/project", "/tmp/sessions", false);
    setResumeActiveSessionManager(activeSession as any);

    const selector = new Selector();
    selector.loadCurrentSessions();
    await Bun.sleep(0);

    expect(selector.sessionList.sessions).toEqual([]);
    expect(selector.indexingStatus?.message).toBe(
      "Indexing full session history…",
    );
    expect(interactiveReads).toBe(0);

    resolveExact(exact);
    await Bun.sleep(0);
    expect(selector.sessionList.sessions.map((session) => session.path)).toEqual(
      ["/tmp/sessions/existing.jsonl"],
    );
    expect(selector.indexingStatus).toBeNull();
  });

  test("current completion does not clear indexing while All is pending", async () => {
    const provisional = [{ ...existing, provisional: true }];
    const exact = [{ ...existing }];
    let resolveCurrent!: (sessions: any[]) => void;
    let resolveAll!: (sessions: any[]) => void;
    const catalog = {
      peek: () => provisional,
      hasPersistedCatalog: () => false,
      open: async () => provisional,
      openExact: (scope: any) =>
        new Promise<any[]>((resolve) => {
          if (scope.cwd) resolveCurrent = resolve;
          else resolveAll = resolve;
        }),
      isProvisional: (sessions: any[]) => sessions === provisional,
      beginInteractiveRead: () => undefined,
      endInteractiveRead: () => undefined,
      unsubscribe: () => undefined,
    };
    const Selector = selectorClass();
    installOptimizeStartup(Selector, catalog as any);
    setResumeSessionScope("/tmp/project", "/tmp/sessions", false);
    setResumeActiveSessionManager(activeSession as any);

    const selector = new Selector() as any;
    selector.loadCurrentSessions();
    await Bun.sleep(0);
    selector.scope = "all";
    const allLoad = selector.allSessionsLoader();
    await Bun.sleep(0);

    resolveCurrent(exact);
    await Bun.sleep(0);
    expect(selector.indexingStatus?.message).toBe(
      "Indexing full session history…",
    );

    resolveAll(exact);
    await allLoad;
    expect(selector.indexingStatus).toBeNull();
  });

  test("reports an exact indexing failure without leaking a rejection", async () => {
    const provisional = [{ ...existing, provisional: true }];
    const catalog = {
      peek: () => provisional,
      hasPersistedCatalog: () => false,
      open: async () => provisional,
      openExact: async () => {
        throw new Error("scan failed");
      },
      isProvisional: (sessions: any[]) => sessions === provisional,
      beginInteractiveRead: () => undefined,
      endInteractiveRead: () => undefined,
      unsubscribe: () => undefined,
    };
    const Selector = selectorClass();
    installOptimizeStartup(Selector, catalog as any);
    setResumeSessionScope("/tmp/project", "/tmp/sessions", false);
    setResumeActiveSessionManager(activeSession as any);

    const selector = new Selector();
    selector.loadCurrentSessions();
    await Bun.sleep(0);

    expect(selector.indexingStatus).toEqual({
      type: "error",
      message: "Failed to load sessions: scan failed",
    });
    expect(selector.sessionList.sessions).toEqual([]);
  });

  test("shows a partial persisted catalog without indexing", async () => {
    const cached = [{ ...existing }];
    let interactiveReads = 0;
    const catalog = {
      peek: () => cached,
      hasPersistedCatalog: () => true,
      open: async () => cached,
      isProvisional: () => false,
      beginInteractiveRead: () => interactiveReads++,
      endInteractiveRead: () => interactiveReads--,
      unsubscribe: () => undefined,
    };
    const Selector = selectorClass();
    installOptimizeStartup(Selector, catalog as any);
    setResumeSessionScope("/tmp/project", "/tmp/sessions", false);
    setResumeActiveSessionManager(activeSession as any);

    const selector = new Selector();
    selector.loadCurrentSessions();
    await Bun.sleep(0);

    expect(selector.sessionList.sessions.map((session) => session.path)).toEqual(
      ["/tmp/sessions/existing.jsonl"],
    );
    expect(selector.indexingStatus).toBeUndefined();
    expect(interactiveReads).toBe(1);
    releaseResumeSelector(selector);
    expect(interactiveReads).toBe(0);
  });
});
