import { afterEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ResumeCatalog } from "../../session-catalog.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { force: true, recursive: true });
  }
});

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "resume-catalog-"));
  temporaryDirectories.push(root);
  const cwd = join(root, "project");
  const sessionDir = join(root, "sessions");
  const cacheDirectory = join(root, "cache");
  const sessionPath = join(sessionDir, "session.jsonl");
  mkdirSync(cwd);
  mkdirSync(sessionDir);
  writeFileSync(
    sessionPath,
    [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "10000000-0000-7000-8000-000000000001",
        timestamp: "2026-01-01T00:00:01.000Z",
        cwd,
      }),
      JSON.stringify({
        type: "message",
        id: "message-1",
        parentId: null,
        timestamp: "2026-01-01T00:00:02.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "CATALOG BODY" }],
          timestamp: Date.parse("2026-01-01T00:00:02.000Z"),
        },
      }),
      JSON.stringify({
        type: "session_info",
        id: "name-1",
        parentId: "message-1",
        timestamp: "2026-01-01T00:00:03.000Z",
        name: "Before restart",
      }),
      "",
    ].join("\n"),
  );
  return { cacheDirectory, cwd, sessionDir, sessionPath };
}

async function openExact(
  catalog: ResumeCatalog,
  scope: { cwd?: string; sessionDir: string; allDirectories?: boolean },
) {
  let publishExact!: (sessions: any[]) => void;
  const exactUpdate = new Promise<any[]>((resolve) => {
    publishExact = resolve;
  });
  const first = await catalog.open(scope, publishExact);
  return catalog.isProvisional(first) ? await exactUpdate : first;
}

describe("ResumeCatalog", () => {
  test("a fresh process sees a rename appended after the catalog was persisted", async () => {
    const fixture = makeFixture();
    const scope = { cwd: fixture.cwd, sessionDir: fixture.sessionDir };

    const firstProcess = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    expect((await openExact(firstProcess, scope))[0]?.name).toBe(
      "Before restart",
    );
    await firstProcess.close();

    appendFileSync(
      fixture.sessionPath,
      `${JSON.stringify({
        type: "message",
        id: "message-2",
        parentId: "message-1",
        timestamp: "2026-01-01T00:00:05.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "APPENDED BODY" }],
          timestamp: Date.parse("2026-01-01T00:00:05.000Z"),
        },
      })}\n${JSON.stringify({
        type: "session_info",
        id: "name-2",
        parentId: "message-2",
        timestamp: "2026-01-01T00:00:10.000Z",
        name: "After restart",
      })}\n`,
    );

    const secondProcess = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    const sessions = await openExact(secondProcess, scope);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.name).toBe("After restart");
    expect(sessions[0]?.modified.toISOString()).toBe(
      "2026-01-01T00:00:10.000Z",
    );
    expect(sessions[0]?.messageCount).toBe(2);
    expect(sessions[0]?.allMessagesText).toBe("CATALOG BODY APPENDED BODY");
    await secondProcess.close();
  });

  test("a fresh process publishes reconciliation after exposing persisted rows", async () => {
    const fixture = makeFixture();
    const scope = { cwd: fixture.cwd, sessionDir: fixture.sessionDir };
    const firstProcess = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    await openExact(firstProcess, scope);
    await firstProcess.close();

    writeFileSync(
      join(fixture.sessionDir, "clone.jsonl"),
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: "10000000-0000-7000-8000-000000000002",
        timestamp: "2026-01-01T00:00:20.000Z",
        cwd: fixture.cwd,
        parentSession: fixture.sessionPath,
      })}\n${JSON.stringify({
        type: "session_info",
        id: "clone-name",
        parentId: null,
        timestamp: "2026-01-01T00:00:21.000Z",
        name: "Indexed Clone",
      })}\n`,
    );

    const secondProcess = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    const reconciliation = secondProcess.prime(scope);
    expect(secondProcess.peek(scope)?.map((session) => session.name)).toEqual([
      "Before restart",
    ]);

    let published: any[] | undefined;
    const immediate = await secondProcess.open(
      { ...scope, subscription: {} },
      (sessions) => {
        published = sessions;
      },
    );
    expect(immediate.map((session) => session.name)).toEqual([
      "Before restart",
    ]);

    await reconciliation;
    expect(published?.map((session) => session.name)).toContain(
      "Indexed Clone",
    );
    await secondProcess.close();
  });

  test("a missing catalog renders provisional rows before exact repair", async () => {
    const fixture = makeFixture();
    const catalog = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    let publishExact!: (sessions: any[]) => void;
    const exactUpdate = new Promise<any[]>((resolve) => {
      publishExact = resolve;
    });
    const firstFrame = await catalog.open(
      { cwd: fixture.cwd, sessionDir: fixture.sessionDir },
      publishExact,
    );
    expect(firstFrame).toHaveLength(1);
    expect(firstFrame[0]?.id).toBe("10000000-0000-7000-8000-000000000001");
    expect(firstFrame[0]?.messageCount).toBe(0);
    expect(catalog.isProvisional(firstFrame)).toBe(true);

    const exact = await exactUpdate;
    expect(exact[0]?.provisional).toBe(false);
    expect(exact[0]?.messageCount).toBe(1);
    await catalog.close();
  });

  test("a cold peek builds provisional rows before its first frame", async () => {
    const fixture = makeFixture();
    const catalog = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });

    const firstFrame = catalog.peek({
      cwd: fixture.cwd,
      sessionDir: fixture.sessionDir,
    });

    expect(firstFrame).toHaveLength(1);
    expect(firstFrame?.[0]?.id).toBe(
      "10000000-0000-7000-8000-000000000001",
    );
    expect(catalog.isProvisional(firstFrame!)).toBe(true);
    await catalog.close();
  });

  test("a persisted catalog validates before returning exact rows", async () => {
    const fixture = makeFixture();
    const scope = { cwd: fixture.cwd, sessionDir: fixture.sessionDir };
    const firstProcess = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    await openExact(firstProcess, scope);
    await firstProcess.close();

    const secondProcess = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    const firstFrame = await secondProcess.open(scope);
    expect(secondProcess.isProvisional(firstFrame)).toBe(false);
    expect(firstFrame[0]?.provisional).toBe(false);
    await secondProcess.close();
  });

  test("a same-size rewrite with restored mtime invalidates cached metadata", async () => {
    const fixture = makeFixture();
    const scope = { cwd: fixture.cwd, sessionDir: fixture.sessionDir };
    const firstProcess = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    await openExact(firstProcess, scope);
    await firstProcess.close();

    const before = statSync(fixture.sessionPath);
    const rewritten = readFileSync(fixture.sessionPath, "utf8").replace(
      "Before restart",
      "Changed title!",
    );
    expect(Buffer.byteLength(rewritten)).toBe(before.size);
    writeFileSync(fixture.sessionPath, rewritten);
    utimesSync(fixture.sessionPath, before.atime, before.mtime);

    const secondProcess = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    expect((await openExact(secondProcess, scope))[0]?.name).toBe(
      "Changed title!",
    );
    await secondProcess.close();
  });

  test("changing one session preserves search text for unchanged sessions", async () => {
    const fixture = makeFixture();
    const secondPath = join(fixture.sessionDir, "second.jsonl");
    writeFileSync(
      secondPath,
      readFileSync(fixture.sessionPath, "utf8")
        .replaceAll(
          "10000000-0000-7000-8000-000000000001",
          "20000000-0000-7000-8000-000000000002",
        )
        .replace("CATALOG BODY", "SECOND BODY"),
    );
    const scope = { sessionDir: fixture.sessionDir };
    const first = new ResumeCatalog({ cacheDirectory: fixture.cacheDirectory });
    await openExact(first, scope);
    await first.close();

    appendFileSync(
      secondPath,
      `${JSON.stringify({ type: "session_info", timestamp: "2026-01-02T00:00:00.000Z", name: "Changed second" })}\n`,
    );
    const second = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    const sessions = await openExact(second, scope);
    expect(sessions.map((session) => session.allMessagesText).sort()).toEqual([
      "CATALOG BODY",
      "SECOND BODY",
    ]);
    await second.close();
  });

  test("a corrupt search sidecar cannot erase unchanged session text", async () => {
    const fixture = makeFixture();
    const secondPath = join(fixture.sessionDir, "second.jsonl");
    writeFileSync(
      secondPath,
      readFileSync(fixture.sessionPath, "utf8")
        .replaceAll(
          "10000000-0000-7000-8000-000000000001",
          "20000000-0000-7000-8000-000000000002",
        )
        .replace("CATALOG BODY", "SECOND BODY"),
    );
    const scope = { sessionDir: fixture.sessionDir };
    const first = new ResumeCatalog({ cacheDirectory: fixture.cacheDirectory });
    await openExact(first, scope);
    await first.close();
    const searchPath = join(
      fixture.cacheDirectory,
      readdirSync(fixture.cacheDirectory).find((name) =>
        name.endsWith(".search.json"),
      )!,
    );
    writeFileSync(searchPath, '{"sessions":null}');
    appendFileSync(
      secondPath,
      `${JSON.stringify({ type: "session_info", timestamp: "2026-01-02T00:00:00.000Z", name: "Changed second" })}\n`,
    );

    const second = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    second.peek(scope);
    expect(second.hasPersistedCatalog(scope)).toBe(false);
    const sessions = await openExact(second, scope);
    expect(sessions.map((session) => session.allMessagesText).sort()).toEqual([
      "CATALOG BODY",
      "SECOND BODY",
    ]);
    await second.close();
  });

  test("a catalog update removes every orphaned search generation", async () => {
    const fixture = makeFixture();
    const scope = { sessionDir: fixture.sessionDir };
    const first = new ResumeCatalog({ cacheDirectory: fixture.cacheDirectory });
    await openExact(first, scope);
    await first.close();

    const searchName = readdirSync(fixture.cacheDirectory).find((name) =>
      name.endsWith(".search.json"),
    )!;
    const cacheKey = searchName.split(".")[0]!;
    const payload = readFileSync(join(fixture.cacheDirectory, searchName));
    writeFileSync(
      join(fixture.cacheDirectory, `${cacheKey}.orphan-one.search.json`),
      payload,
    );
    writeFileSync(
      join(fixture.cacheDirectory, `${cacheKey}.orphan-two.search.json`),
      payload,
    );
    appendFileSync(
      fixture.sessionPath,
      `${JSON.stringify({ type: "session_info", timestamp: "2026-01-02T00:00:00.000Z", name: "Cleanup write" })}\n`,
    );

    const second = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    await openExact(second, scope);
    expect(
      readdirSync(fixture.cacheDirectory).filter(
        (name) =>
          name.startsWith(`${cacheKey}.`) && name.endsWith(".search.json"),
      ),
    ).toHaveLength(1);
    await second.close();
  });

  test("growth after a historical rewrite does not use stale reduced data", async () => {
    const fixture = makeFixture();
    const original = "ORIGINAL SEARCH BODY";
    const rewritten = "REWRITTEN TEXT BODY!";
    const content = readFileSync(fixture.sessionPath, "utf8")
      .replace("CATALOG BODY", original)
      .replace("Before restart", `Before restart${"x".repeat(6000)}`);
    writeFileSync(fixture.sessionPath, content);
    const scope = { sessionDir: fixture.sessionDir };
    const first = new ResumeCatalog({ cacheDirectory: fixture.cacheDirectory });
    await openExact(first, scope);
    await first.close();

    writeFileSync(
      fixture.sessionPath,
      `${content.replace(original, rewritten)}${JSON.stringify({ type: "session_info", timestamp: "2026-01-03T00:00:00.000Z", name: "After rewrite" })}\n`,
    );
    const second = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    expect((await openExact(second, scope))[0]?.allMessagesText).toBe(
      rewritten,
    );
    await second.close();
  });

  test("exact parsing includes a valid final record without a newline", async () => {
    const fixture = makeFixture();
    writeFileSync(
      fixture.sessionPath,
      JSON.stringify({
        type: "session",
        version: 3,
        id: "10000000-0000-7000-8000-000000000001",
        timestamp: "2026-01-01T00:00:01.000Z",
        cwd: fixture.cwd,
      }),
    );
    const catalog = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    const sessions = await openExact(catalog, {
      sessionDir: fixture.sessionDir,
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toBe("10000000-0000-7000-8000-000000000001");
    await catalog.close();
  });

  test("an unchanged persisted catalog reopens without indexing", async () => {
    const fixture = makeFixture();
    const scope = { sessionDir: fixture.sessionDir };
    const first = new ResumeCatalog({ cacheDirectory: fixture.cacheDirectory });
    await openExact(first, scope);
    await first.close();

    const second = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    const reopened = await second.open(scope);
    expect(second.isProvisional(reopened)).toBe(false);
    expect(reopened).toHaveLength(1);
    await second.close();
  });

  test("exact indexing completes for a missing session directory", async () => {
    const fixture = makeFixture();
    const missing = join(dirname(fixture.sessionDir), "missing-sessions");
    const catalog = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    const reader = {};
    catalog.beginInteractiveRead(reader);

    const sessions = await catalog.openExact({ sessionDir: missing });

    expect(sessions).toEqual([]);
    expect(catalog.hasPersistedCatalog({ sessionDir: missing })).toBe(true);
    catalog.endInteractiveRead(reader);
    await catalog.close();
  });

  test("a cold process adopts a cache that appears before the picker opens", async () => {
    const fixture = makeFixture();
    const scope = { sessionDir: fixture.sessionDir };
    const writer = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    await openExact(writer, scope);
    await writer.close();

    const savedCache = `${fixture.cacheDirectory}-saved`;
    renameSync(fixture.cacheDirectory, savedCache);
    mkdirSync(fixture.cacheDirectory, { recursive: true });
    const catalog = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    const reader = {};
    catalog.beginInteractiveRead(reader);
    const cold = catalog.peek(scope);
    expect(catalog.hasPersistedCatalog(scope)).toBe(false);
    expect(catalog.isProvisional(cold!)).toBe(true);

    rmSync(fixture.cacheDirectory, { recursive: true, force: true });
    renameSync(savedCache, fixture.cacheDirectory);
    const adopted = catalog.peek(scope);

    expect(catalog.hasPersistedCatalog(scope)).toBe(true);
    expect(catalog.isProvisional(adopted!)).toBe(false);
    expect(adopted?.map((session) => session.id)).toEqual([
      "10000000-0000-7000-8000-000000000001",
    ]);
    catalog.endInteractiveRead(reader);
    await catalog.close();
  });

  test("a no-op watcher event does not make the catalog provisional", async () => {
    const fixture = makeFixture();
    const scope = { sessionDir: fixture.sessionDir };
    const catalog = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    await openExact(catalog, scope);

    catalog.invalidate(fixture.sessionDir, "session.jsonl");
    const reopened = await catalog.open(scope);
    expect(catalog.isProvisional(reopened)).toBe(false);
    expect(reopened).toHaveLength(1);
    await catalog.close();
  });

  test("a directory-wide watcher event keeps the exact snapshot", async () => {
    const fixture = makeFixture();
    const scope = { sessionDir: fixture.sessionDir };
    const catalog = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    await openExact(catalog, scope);

    catalog.invalidate(fixture.sessionDir);
    expect(catalog.peek(scope)).toHaveLength(1);
    await catalog.close();
  });

  test("a dirty snapshot marks deleted rows provisional until refresh", async () => {
    const fixture = makeFixture();
    const scope = { sessionDir: fixture.sessionDir };
    const catalog = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    await openExact(catalog, scope);
    unlinkSync(fixture.sessionPath);
    catalog.invalidate(fixture.sessionDir, "session.jsonl");
    const stale = await catalog.open(scope);
    expect(stale[0]?.provisional).toBe(true);
    await catalog.close();
  });

  test("cwd filtering resolves equivalent paths", async () => {
    const fixture = makeFixture();
    const nested = join(fixture.cwd, "nested");
    mkdirSync(nested);
    const equivalent = `${nested}/..`;
    writeFileSync(
      fixture.sessionPath,
      readFileSync(fixture.sessionPath, "utf8").replace(
        fixture.cwd,
        equivalent,
      ),
    );
    const catalog = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    const sessions = await openExact(catalog, {
      cwd: fixture.cwd,
      sessionDir: fixture.sessionDir,
    });
    expect(sessions).toHaveLength(1);
    await catalog.close();
  });

  test("malformed search payloads rebuild without throwing", async () => {
    const fixture = makeFixture();
    const scope = { sessionDir: fixture.sessionDir };
    const first = new ResumeCatalog({ cacheDirectory: fixture.cacheDirectory });
    await openExact(first, scope);
    await first.close();
    const searchPath = join(
      fixture.cacheDirectory,
      readdirSync(fixture.cacheDirectory).find((name) =>
        name.endsWith(".search.json"),
      )!,
    );
    const payload = JSON.parse(readFileSync(searchPath, "utf8"));
    payload.sessions = null;
    writeFileSync(searchPath, JSON.stringify(payload));

    const second = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    let resolveRecovered!: () => void;
    const recovered = new Promise<void>((resolve) => {
      resolveRecovered = resolve;
    });
    const firstFrame = await second.open(scope, (sessions) => {
      if (sessions[0]?.allMessagesText === "CATALOG BODY") resolveRecovered();
    });
    expect(() => firstFrame[0]?.allMessagesText).not.toThrow();
    await recovered;
    await second.close();
  });

  test("malformed manifest records are rejected", async () => {
    const fixture = makeFixture();
    const scope = { sessionDir: fixture.sessionDir };
    const first = new ResumeCatalog({ cacheDirectory: fixture.cacheDirectory });
    await openExact(first, scope);
    await first.close();
    const manifestPath = join(
      fixture.cacheDirectory,
      readdirSync(fixture.cacheDirectory).find((name) =>
        /^[^.]+\.json$/.test(name),
      )!,
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.records["session.jsonl"] = null;
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const second = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    expect((await openExact(second, scope))[0]?.allMessagesText).toBe(
      "CATALOG BODY",
    );
    await second.close();
  });

  test("malformed optional manifest fields are rejected", async () => {
    const fixture = makeFixture();
    const scope = { sessionDir: fixture.sessionDir };
    const first = new ResumeCatalog({ cacheDirectory: fixture.cacheDirectory });
    await openExact(first, scope);
    await first.close();
    const manifestPath = join(
      fixture.cacheDirectory,
      readdirSync(fixture.cacheDirectory).find((name) =>
        /^[^.]+\.json$/.test(name),
      )!,
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.records["session.jsonl"].session.name = {};
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const second = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    expect((await openExact(second, scope))[0]?.name).toBe("Before restart");
    await second.close();
  });

  test("distinct subscriptions both receive directory updates", async () => {
    const fixture = makeFixture();
    const catalog = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    const currentSubscription = {};
    const allSubscription = {};
    let armed = false;
    const seen = new Set<object>();
    let resolveBoth!: () => void;
    const both = new Promise<void>((resolve) => {
      resolveBoth = resolve;
    });
    const listener = (subscription: object) => () => {
      if (!armed) return;
      seen.add(subscription);
      if (seen.size === 2) resolveBoth();
    };
    await openExact(catalog, {
      sessionDir: fixture.sessionDir,
      subscription: currentSubscription,
    } as any);
    await catalog.open(
      {
        sessionDir: fixture.sessionDir,
        subscription: currentSubscription,
      } as any,
      listener(currentSubscription),
    );
    await catalog.open(
      { sessionDir: fixture.sessionDir, subscription: allSubscription } as any,
      listener(allSubscription),
    );
    armed = true;
    appendFileSync(
      fixture.sessionPath,
      `${JSON.stringify({ type: "session_info", timestamp: "2026-01-05T00:00:00.000Z", name: "Both listeners" })}\n`,
    );
    catalog.invalidate(fixture.sessionDir);
    await Promise.race([both, Bun.sleep(500)]);
    expect(seen.size).toBe(2);
    await catalog.close();
  });

  test("All scope follows symlinked session directories", async () => {
    const fixture = makeFixture();
    const allRoot = join(fixture.sessionDir, "..", "all");
    mkdirSync(allRoot);
    symlinkSync(fixture.sessionDir, join(allRoot, "linked"));
    const catalog = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    const sessions = await openExact(catalog, {
      sessionDir: allRoot,
      allDirectories: true,
    });
    expect(sessions).toHaveLength(1);
    await catalog.close();
  });

  test("a dead writer lock does not prevent future catalog updates", async () => {
    const fixture = makeFixture();
    const scope = { sessionDir: fixture.sessionDir };
    const first = new ResumeCatalog({ cacheDirectory: fixture.cacheDirectory });
    await openExact(first, scope);
    await first.close();
    const manifestPath = join(
      fixture.cacheDirectory,
      readdirSync(fixture.cacheDirectory).find((name) =>
        /^[^.]+\.json$/.test(name),
      )!,
    );
    writeFileSync(`${manifestPath}.lock`, JSON.stringify({ pid: 99_999_999 }));
    appendFileSync(
      fixture.sessionPath,
      `${JSON.stringify({ type: "session_info", timestamp: "2026-01-04T00:00:00.000Z", name: "After dead lock" })}\n`,
    );

    const second = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    await openExact(second, scope);
    await second.close();
    const third = new ResumeCatalog({ cacheDirectory: fixture.cacheDirectory });
    await third.prime(scope);
    expect((await third.open(scope))[0]?.name).toBe("After dead lock");
    await third.close();
  });

  test("an old empty writer lock is recovered", async () => {
    const fixture = makeFixture();
    const scope = { sessionDir: fixture.sessionDir };
    const first = new ResumeCatalog({ cacheDirectory: fixture.cacheDirectory });
    await openExact(first, scope);
    await first.close();
    const manifestPath = join(
      fixture.cacheDirectory,
      readdirSync(fixture.cacheDirectory).find((name) =>
        /^[^.]+\.json$/.test(name),
      )!,
    );
    const lockPath = `${manifestPath}.lock`;
    writeFileSync(lockPath, "");
    const old = new Date(Date.now() - 60_000);
    utimesSync(lockPath, old, old);
    appendFileSync(
      fixture.sessionPath,
      `${JSON.stringify({ type: "session_info", timestamp: "2026-01-06T00:00:00.000Z", name: "After empty lock" })}\n`,
    );

    const second = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    await openExact(second, scope);
    await second.close();
    const third = new ResumeCatalog({ cacheDirectory: fixture.cacheDirectory });
    await third.prime(scope);
    expect((await third.open(scope))[0]?.name).toBe("After empty lock");
    await third.close();
  });

  test("All scope reads every session directory", async () => {
    const fixture = makeFixture();
    const root = join(fixture.sessionDir, "..");
    const secondDirectory = join(root, "other-sessions");
    mkdirSync(secondDirectory);
    writeFileSync(
      join(secondDirectory, "second.jsonl"),
      readFileSync(fixture.sessionPath, "utf8")
        .replaceAll(
          "10000000-0000-7000-8000-000000000001",
          "30000000-0000-7000-8000-000000000003",
        )
        .replace("Before restart", "Second directory"),
    );

    const catalog = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    const sessions = await openExact(catalog, {
      sessionDir: root,
      allDirectories: true,
    });
    expect(sessions.map((session) => session.name).sort()).toEqual([
      "Before restart",
      "Second directory",
    ]);
    await catalog.close();
  });

  test("All scope returns persisted rows during an interactive read", async () => {
    const fixture = makeFixture();
    const root = join(fixture.sessionDir, "..");
    const secondDirectory = join(root, "other-sessions");
    const secondPath = join(secondDirectory, "second.jsonl");
    mkdirSync(secondDirectory);
    writeFileSync(
      secondPath,
      readFileSync(fixture.sessionPath, "utf8").replaceAll(
        "10000000-0000-7000-8000-000000000001",
        "30000000-0000-7000-8000-000000000003",
      ),
    );
    const first = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    await openExact(first, { sessionDir: fixture.sessionDir });
    await openExact(first, { sessionDir: secondDirectory });
    await first.close();
    appendFileSync(
      secondPath,
      `${JSON.stringify({ type: "session_info", timestamp: "2026-01-07T00:00:00.000Z", name: "Changed while paused" })}\n`,
    );

    const second = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    const reader = {};
    second.beginInteractiveRead(reader);
    const timeout = Symbol("timeout");
    const result = await Promise.race([
      second.open({ sessionDir: root, allDirectories: true }),
      Bun.sleep(100).then(() => timeout),
    ]);
    second.endInteractiveRead(reader);

    expect(result).not.toBe(timeout);
    expect(result).toHaveLength(2);
    await second.close();
  });

  test("live updates keep the current-directory cwd filter", async () => {
    const fixture = makeFixture();
    const otherCwd = join(fixture.cwd, "other");
    mkdirSync(otherCwd);
    writeFileSync(
      join(fixture.sessionDir, "other.jsonl"),
      readFileSync(fixture.sessionPath, "utf8")
        .replaceAll(
          "10000000-0000-7000-8000-000000000001",
          "20000000-0000-7000-8000-000000000002",
        )
        .replace(fixture.cwd, otherCwd)
        .replace("Before restart", "Other cwd"),
    );

    const catalog = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    const update = new Promise<any[]>((resolve) => {
      void catalog.open(
        { cwd: fixture.cwd, sessionDir: fixture.sessionDir },
        resolve,
      );
    });
    catalog.invalidate(fixture.sessionDir, "session.jsonl");

    const sessions = await update;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.cwd).toBe(fixture.cwd);
    await catalog.close();
  });
});
