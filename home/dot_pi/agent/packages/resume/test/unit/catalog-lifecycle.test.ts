import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import resumeExtension from "../../index.ts";
import { writeSession } from "../e2e/support.ts";

const PATCH_STATE = Symbol.for("resume:catalog-patch-state");
const tempDirectories: string[] = [];

afterEach(() => {
  for (const path of tempDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function extensionHarness() {
  const handlers = new Map<string, ((event: any, ctx?: any) => unknown)[]>();
  const pi = {
    on(event: string, handler: (event: any, ctx?: any) => unknown) {
      const registered = handlers.get(event) ?? [];
      registered.push(handler);
      handlers.set(event, registered);
    },
  };
  resumeExtension(pi as any);
  return {
    emit: async (event: string, payload: any = {}) => {
      for (const handler of handlers.get(event) ?? []) await handler(payload);
    },
  };
}

function activeCatalog(): any {
  return (globalThis as any)[PATCH_STATE]?.catalog;
}

async function openExact(catalog: any, sessionDir: string): Promise<any[]> {
  let publishExact!: (sessions: any[]) => void;
  const exactUpdate = new Promise<any[]>((resolve) => {
    publishExact = resolve;
  });
  const first = await catalog.open({ sessionDir }, publishExact);
  return catalog.isProvisional(first) ? await exactUpdate : first;
}

describe("resume catalog lifecycle", () => {
  test("session replacement keeps the warmed catalog snapshot", async () => {
    const root = mkdtempSync(join(tmpdir(), "resume-catalog-lifecycle-"));
    tempDirectories.push(root);
    const sessions = join(root, "sessions");
    writeSession(
      join(sessions, "source.jsonl"),
      "78000000-0000-7000-8000-000000000001",
      "Lifecycle Source",
      ["LIFECYCLE SOURCE BODY"],
      1,
    );

    const firstRuntime = extensionHarness();
    const firstCatalog = activeCatalog();
    await openExact(firstCatalog, sessions);
    expect(firstCatalog.peek({ sessionDir: sessions })).toHaveLength(1);

    await firstRuntime.emit("session_shutdown", { reason: "fork" });
    extensionHarness();

    expect(activeCatalog()).toBe(firstCatalog);
    expect(activeCatalog().peek({ sessionDir: sessions })).toHaveLength(1);
  });
});
