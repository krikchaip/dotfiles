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
  test("shows provisional catalog rows without indexing status", async () => {
    const provisional = [
      {
        path: "/tmp/sessions/existing.jsonl",
        id: "79000000-0000-7000-8000-000000000002",
        cwd: "/tmp/project",
        created: new Date("2026-09-06T00:00:00.000Z"),
        modified: new Date("2026-09-06T00:00:00.000Z"),
        messageCount: 0,
        firstMessage: "Existing session",
        provisional: true,
      },
    ];
    let interactiveReads = 0;
    const catalog = {
      peek: () => provisional,
      open: async () => provisional,
      isProvisional: (sessions: any[]) => sessions === provisional,
      beginInteractiveRead: () => interactiveReads++,
      endInteractiveRead: () => interactiveReads--,
      unsubscribe: () => undefined,
    };

    class Selector {
      currentSessions: any[] | undefined;
      currentLoading = true;
      scope = "current";
      originalLoadCalls = 0;
      indexingStatus: any;
      header = {
        setScope: () => undefined,
        setLoading: () => undefined,
        setStatusMessage: (status: any) => {
          this.indexingStatus = status;
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
    }

    installOptimizeStartup(Selector, catalog as any);
    setResumeSessionScope("/tmp/project", "/tmp/sessions", false);
    setResumeActiveSessionManager({
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
    } as any);

    const selector = new Selector();
    selector.loadCurrentSessions();

    expect(selector.originalLoadCalls).toBe(0);
    expect(selector.currentLoading).toBe(false);
    await Bun.sleep(0);

    expect(selector.sessionList.sessions).toHaveLength(2);
    expect(selector.sessionList.sessions.map((session) => session.path)).toEqual(
      ["/tmp/sessions/active.jsonl", "/tmp/sessions/existing.jsonl"],
    );
    expect(selector.indexingStatus).toBeUndefined();
    expect(interactiveReads).toBe(1);
    releaseResumeSelector(selector);
    expect(interactiveReads).toBe(0);

    let resolveDelayed!: (sessions: any[]) => void;
    const delayedProvisional = provisional.slice();
    installOptimizeStartup(Selector, {
      peek: () => undefined,
      open: () =>
        new Promise<any[]>((resolve) => {
          resolveDelayed = resolve;
        }),
      isProvisional: (sessions: any[]) => sessions === delayedProvisional,
      beginInteractiveRead: () => undefined,
      endInteractiveRead: () => undefined,
      unsubscribe: () => undefined,
    } as any);
    const earlySelector = new Selector();
    earlySelector.loadCurrentSessions();
    resolveDelayed(delayedProvisional);
    await Bun.sleep(0);

    expect(earlySelector.sessionList.sessions).toHaveLength(2);
    expect(earlySelector.indexingStatus).toBeUndefined();
  });
});
