import { afterEach, describe, expect, test } from "bun:test";
import {
  installOptimizeStartup,
  setResumeActiveSessionManager,
  setResumeSessionScope,
} from "../../optimize-startup.ts";

afterEach(() => {
  setResumeActiveSessionManager(undefined);
  setResumeSessionScope(undefined, undefined);
});

describe("resume selector cold startup", () => {
  test("shows the active session while catalog indexing continues", () => {
    let resolveOpen!: (sessions: any[]) => void;
    const catalog = {
      peek: () => undefined,
      open: () =>
        new Promise<any[]>((resolve) => {
          resolveOpen = resolve;
        }),
      isProvisional: () => false,
      unsubscribe: () => undefined,
    };

    class Selector {
      currentSessions: any[] | undefined;
      currentLoading = true;
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
    expect(selector.sessionList.sessions).toHaveLength(1);
    expect(selector.sessionList.sessions[0]?.path).toBe(
      "/tmp/sessions/active.jsonl",
    );
    expect(selector.indexingStatus?.message).toBe(
      "Indexing full session history…",
    );

    resolveOpen([]);
  });
});
