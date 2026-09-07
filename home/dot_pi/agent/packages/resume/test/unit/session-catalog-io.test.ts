import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import * as realFs from "node:fs";
import * as realFsPromises from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = realFs.mkdtempSync(join(tmpdir(), "resume-catalog-io-test-"));
const largeRecordBytes = Number(
  process.env.RESUME_TEST_LARGE_RECORD_BYTES ?? 4 * 1024 * 1024,
);
let observedPath: string | undefined;
let observeReads = false;
let failReadPathOnce: string | undefined;
let reads: Array<{ start: number; bytes: number }> = [];
const originalCreateReadStream = realFs.createReadStream;
const originalStat = realFsPromises.stat;

type StatBarrier = {
  path: string;
  calls: number;
  active: number;
  maxActive: number;
  started: Promise<void>;
  markStarted: () => void;
  release: Promise<void>;
  allowFirst: () => void;
};

let statBarrier: StatBarrier | undefined;

function createStatBarrier(path: string): StatBarrier {
  let markStarted!: () => void;
  let allowFirst!: () => void;
  return {
    path,
    calls: 0,
    active: 0,
    maxActive: 0,
    started: new Promise<void>((resolve) => {
      markStarted = resolve;
    }),
    markStarted: () => markStarted(),
    release: new Promise<void>((resolve) => {
      allowFirst = resolve;
    }),
    allowFirst: () => allowFirst(),
  };
}

mock.module("node:fs", () => ({
  ...realFs,
  createReadStream(
    path: realFs.PathLike,
    options?: Parameters<typeof realFs.createReadStream>[1],
  ) {
    if (String(path) === failReadPathOnce) {
      failReadPathOnce = undefined;
      throw new Error("Injected concurrent file replacement");
    }
    const stream = originalCreateReadStream(path, options as any);
    if (observeReads && String(path) === observedPath) {
      const read = {
        start:
          typeof options === "object" &&
          options &&
          typeof options.start === "number"
            ? options.start
            : 0,
        bytes: 0,
      };
      reads.push(read);
      stream.on("data", (chunk) => {
        read.bytes += Buffer.byteLength(chunk);
      });
    }
    return stream;
  },
}));

mock.module("node:fs/promises", () => ({
  ...realFsPromises,
  async stat(
    path: realFs.PathLike,
    options?: Parameters<typeof realFsPromises.stat>[1],
  ) {
    const barrier = statBarrier;
    if (!barrier || String(path) !== barrier.path) {
      return originalStat(path, options as any);
    }
    barrier.calls++;
    barrier.active++;
    barrier.maxActive = Math.max(barrier.maxActive, barrier.active);
    try {
      if (barrier.calls === 1) {
        barrier.markStarted();
        await barrier.release;
      }
      return await originalStat(path, options as any);
    } finally {
      barrier.active--;
    }
  },
}));

const { ResumeCatalog } = await import("../../session-catalog.ts?io-observer");

function makeFixture() {
  const fixtureRoot = realFs.mkdtempSync(join(root, "fixture-"));
  const cacheDirectory = join(fixtureRoot, "cache");
  const sessionDir = join(fixtureRoot, "sessions");
  const sessionPath = join(sessionDir, "large.jsonl");
  realFs.mkdirSync(sessionDir);
  const entries = [
    {
      type: "session",
      version: 3,
      id: "91000000-0000-7000-8000-000000000001",
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: fixtureRoot,
    },
    {
      type: "message",
      id: "large-message",
      parentId: null,
      timestamp: "2026-01-01T00:00:01.000Z",
      message: {
        role: "user",
        content: `BEGIN${"x".repeat(largeRecordBytes)}END`,
      },
    },
  ];
  realFs.writeFileSync(
    sessionPath,
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
  );
  return { cacheDirectory, sessionDir, sessionPath };
}

async function openExact(
  catalog: InstanceType<typeof ResumeCatalog>,
  sessionDir: string,
) {
  let resolveExact!: (sessions: any[]) => void;
  const exact = new Promise<any[]>((resolve) => {
    resolveExact = resolve;
  });
  const first = await catalog.open({ sessionDir }, resolveExact);
  return catalog.isProvisional(first) ? await exact : first;
}

beforeEach(() => {
  observedPath = undefined;
  observeReads = false;
  failReadPathOnce = undefined;
  reads = [];
  statBarrier = undefined;
});

afterAll(() => {
  realFs.rmSync(root, { force: true, recursive: true });
  mock.restore();
});

describe("ResumeCatalog incremental I/O", () => {
  test("cold bootstrap exposes rows before exact parsing", async () => {
    const fixture = makeFixture();
    const catalog = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });

    const first = await catalog.open({ sessionDir: fixture.sessionDir }, () => {});

    expect(catalog.isProvisional(first)).toBe(true);
    expect(first).toHaveLength(1);
    expect(first[0]?.id).toBe("91000000-0000-7000-8000-000000000001");
    expect(first[0]?.path).toBe(fixture.sessionPath);
    await catalog.close();
  });

  test("cold bootstrap finds a title between large records", async () => {
    const fixtureRoot = realFs.mkdtempSync(join(root, "middle-title-"));
    const sessionDir = join(fixtureRoot, "sessions");
    const sessionPath = join(sessionDir, "middle-title.jsonl");
    realFs.mkdirSync(sessionDir);
    const entries = [
      {
        type: "session",
        id: "92000000-0000-7000-8000-000000000001",
        timestamp: "2026-01-01T00:00:00.000Z",
        cwd: fixtureRoot,
      },
      {
        type: "message",
        timestamp: "2026-01-01T00:00:01.000Z",
        message: { role: "user", content: "WRONG COLD TITLE" },
      },
      {
        type: "message",
        timestamp: "2026-01-01T00:00:02.000Z",
        message: { role: "user", content: "x".repeat(24 * 1024) },
      },
      {
        type: "session_info",
        timestamp: "2026-01-01T00:00:03.000Z",
        name: "Correct Middle Title",
      },
      {
        type: "message",
        timestamp: "2026-01-01T00:00:04.000Z",
        message: { role: "user", content: "y".repeat(24 * 1024) },
      },
    ];
    realFs.writeFileSync(
      sessionPath,
      `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    );
    const catalog = new ResumeCatalog({
      cacheDirectory: join(fixtureRoot, "cache"),
    });

    const first = catalog.peek({ sessionDir });

    expect(first).toHaveLength(1);
    expect(first?.[0]?.name).toBe("Correct Middle Title");
    await catalog.close();
  });

  test("cold bootstrap accepts a final title without a newline", async () => {
    const fixtureRoot = realFs.mkdtempSync(join(root, "final-title-"));
    const sessionDir = join(fixtureRoot, "sessions");
    const sessionPath = join(sessionDir, "final-title.jsonl");
    realFs.mkdirSync(sessionDir);
    const entries = [
      {
        type: "session",
        id: "92000000-0000-7000-8000-000000000002",
        timestamp: "2026-01-01T00:00:00.000Z",
        cwd: fixtureRoot,
      },
      {
        type: "message",
        timestamp: "2026-01-01T00:00:01.000Z",
        message: { role: "user", content: "WRONG FINAL TITLE" },
      },
      {
        type: "message",
        timestamp: "2026-01-01T00:00:02.000Z",
        message: { role: "user", content: "x".repeat(24 * 1024) },
      },
      {
        type: "session_info",
        timestamp: "2026-01-01T00:00:03.000Z",
        name: "Correct Final Title",
      },
    ];
    realFs.writeFileSync(
      sessionPath,
      entries.map((entry) => JSON.stringify(entry)).join("\n"),
    );
    const catalog = new ResumeCatalog({
      cacheDirectory: join(fixtureRoot, "cache"),
    });

    const first = catalog.peek({ sessionDir });

    expect(first?.[0]?.name).toBe("Correct Final Title");
    await catalog.close();
  });

  test("cold bootstrap stitches the latest title across chunks", async () => {
    const fixtureRoot = realFs.mkdtempSync(join(root, "boundary-title-"));
    const sessionDir = join(fixtureRoot, "sessions");
    const sessionPath = join(sessionDir, "boundary-title.jsonl");
    realFs.mkdirSync(sessionDir);
    const prefix = [
      {
        type: "session",
        id: "92000000-0000-7000-8000-000000000003",
        timestamp: "2026-01-01T00:00:00.000Z",
        cwd: fixtureRoot,
      },
      {
        type: "message",
        timestamp: "2026-01-01T00:00:01.000Z",
        message: { role: "user", content: "WRONG BOUNDARY TITLE" },
      },
      {
        type: "session_info",
        timestamp: "2026-01-01T00:00:02.000Z",
        name: "Older Title",
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n");
    const latest = JSON.stringify({
      type: "session_info",
      timestamp: "2026-01-01T00:00:03.000Z",
      name: "Latest Boundary Title",
    });
    const tailTemplate = JSON.stringify({
      type: "message",
      timestamp: "2026-01-01T00:00:04.000Z",
      message: { role: "user", content: "" },
    });
    const tailLength =
      64 * 1024 + 10 - Buffer.byteLength(latest) - 1;
    const tail = tailTemplate.replace(
      '"content":""',
      `"content":"${"y".repeat(tailLength - Buffer.byteLength(tailTemplate) - 1)}"`,
    );
    realFs.writeFileSync(sessionPath, `${prefix}\n${latest}\n${tail}\n`);
    const catalog = new ResumeCatalog({
      cacheDirectory: join(fixtureRoot, "cache"),
    });

    const first = catalog.peek({ sessionDir });

    expect(first?.[0]?.name).toBe("Latest Boundary Title");
    await catalog.close();
  });

  test("interactive reads pause exact reconciliation", async () => {
    const fixture = makeFixture();
    const catalog = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    const reader = {};
    catalog.beginInteractiveRead(reader);
    let publishExact!: (sessions: any[]) => void;
    let exactPublished = false;
    const exact = new Promise<any[]>((resolve) => {
      publishExact = (sessions) => {
        exactPublished = true;
        resolve(sessions);
      };
    });

    const first = await catalog.open(
      { sessionDir: fixture.sessionDir },
      publishExact,
    );
    expect(catalog.isProvisional(first)).toBe(true);
    await Bun.sleep(25);
    expect(exactPublished).toBe(false);

    catalog.endInteractiveRead(reader);
    expect(await exact).toHaveLength(1);
    await catalog.close();
  });

  test("a tiny append reads only the appended session range", async () => {
    const fixture = makeFixture();
    const first = new ResumeCatalog({ cacheDirectory: fixture.cacheDirectory });
    await openExact(first, fixture.sessionDir);
    await first.close();

    const manifestPath = realFs
      .readdirSync(fixture.cacheDirectory)
      .map((name) => join(fixture.cacheDirectory, name))
      .find((path) => path.endsWith(".json") && !path.endsWith(".search.json"));
    const legacyManifest = JSON.parse(
      realFs.readFileSync(manifestPath!, "utf8"),
    );
    delete legacyManifest.records["large.jsonl"].historyHash;
    realFs.writeFileSync(manifestPath!, JSON.stringify(legacyManifest));

    const appendStart = realFs.statSync(fixture.sessionPath).size;
    realFs.appendFileSync(
      fixture.sessionPath,
      `${JSON.stringify({
        type: "session_info",
        id: "rename-after-large-record",
        parentId: "large-message",
        timestamp: "2026-01-01T00:00:02.000Z",
        name: "After tiny append",
      })}\n`,
    );
    observedPath = fixture.sessionPath;
    observeReads = true;

    const reconcileStarted = performance.now();
    const second = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    const sessions = await openExact(second, fixture.sessionDir);
    const reconcileMs = performance.now() - reconcileStarted;

    if (process.env.RESUME_TEST_REPORT_PERF === "1") {
      console.log(
        JSON.stringify({
          appendReconcileMs: Number(reconcileMs.toFixed(2)),
          appendStart,
          readStart: reads[0]?.start,
          bytesRead: reads[0]?.bytes,
        }),
      );
    }
    expect(sessions[0]?.name).toBe("After tiny append");
    expect(reads).toHaveLength(1);
    expect(reads[0]?.start).toBe(appendStart);
    expect(reads[0]?.bytes).toBeLessThan(64 * 1024);
    await second.close();
  });

  test("a metadata-only append does not rewrite unchanged search data", async () => {
    const fixture = makeFixture();
    const first = new ResumeCatalog({ cacheDirectory: fixture.cacheDirectory });
    await openExact(first, fixture.sessionDir);
    await first.close();

    const manifestPath = realFs
      .readdirSync(fixture.cacheDirectory)
      .map((name) => join(fixture.cacheDirectory, name))
      .find((path) => path.endsWith(".json") && !path.endsWith(".search.json"));
    expect(manifestPath).toBeTruthy();
    const before = JSON.parse(realFs.readFileSync(manifestPath!, "utf8"));
    const searchPath = join(
      fixture.cacheDirectory,
      `${manifestPath!
        .split("/")
        .pop()!
        .replace(/\.json$/, "")}.${before.searchGeneration}.search.json`,
    );
    const searchStats = realFs.statSync(searchPath, { bigint: true });

    realFs.appendFileSync(
      fixture.sessionPath,
      `${JSON.stringify({
        type: "session_info",
        id: "metadata-only",
        parentId: "large-message",
        timestamp: "2026-01-01T00:00:02.000Z",
        name: "Metadata only",
      })}\n`,
    );
    const second = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    await openExact(second, fixture.sessionDir);
    await second.close();

    const after = JSON.parse(realFs.readFileSync(manifestPath!, "utf8"));
    expect(after.searchGeneration).toBe(before.searchGeneration);
    expect(realFs.statSync(searchPath, { bigint: true }).ino).toBe(
      searchStats.ino,
    );
  });

  test("a failed persisted reconciliation remains retryable", async () => {
    const fixture = makeFixture();
    const first = new ResumeCatalog({ cacheDirectory: fixture.cacheDirectory });
    await openExact(first, fixture.sessionDir);
    await first.close();

    const clonePath = join(fixture.sessionDir, "clone.jsonl");
    realFs.writeFileSync(
      clonePath,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: "91000000-0000-7000-8000-000000000002",
        timestamp: "2026-01-01T00:00:02.000Z",
        cwd: join(fixture.sessionDir, ".."),
      })}\n`,
    );
    failReadPathOnce = clonePath;

    const second = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    await expect(second.prime({ sessionDir: fixture.sessionDir })).rejects.toThrow(
      "Injected concurrent file replacement",
    );
    expect(second.peek({ sessionDir: fixture.sessionDir })).toHaveLength(1);

    await second.prime({ sessionDir: fixture.sessionDir });
    expect(second.peek({ sessionDir: fixture.sessionDir })).toHaveLength(2);
    await second.close();
  });

  test("a coalesced no-op startup invalidation does not publish", async () => {
    const fixture = makeFixture();
    const first = new ResumeCatalog({ cacheDirectory: fixture.cacheDirectory });
    await openExact(first, fixture.sessionDir);
    await first.close();

    const barrier = createStatBarrier(fixture.sessionPath);
    statBarrier = barrier;
    const second = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    let publications = 0;
    const opening = second.open({ sessionDir: fixture.sessionDir }, () => {
      publications++;
    });
    await barrier.started;
    second.invalidate(fixture.sessionDir);
    barrier.allowFirst();
    await opening;
    await Bun.sleep(20);

    expect(publications).toBe(0);
    await second.close();
  });

  test("a changed coalesced startup reconciliation publishes once", async () => {
    const fixture = makeFixture();
    const first = new ResumeCatalog({ cacheDirectory: fixture.cacheDirectory });
    await openExact(first, fixture.sessionDir);
    await first.close();
    realFs.appendFileSync(
      fixture.sessionPath,
      `${JSON.stringify({
        type: "session_info",
        id: "coalesced-change",
        parentId: "large-message",
        timestamp: "2026-01-01T00:00:02.000Z",
        name: "Coalesced change",
      })}\n`,
    );

    const barrier = createStatBarrier(fixture.sessionPath);
    statBarrier = barrier;
    const second = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    const publications: any[][] = [];
    const opening = second.open(
      { sessionDir: fixture.sessionDir },
      (sessions) => {
        publications.push(sessions);
      },
    );
    await barrier.started;
    second.invalidate(fixture.sessionDir);
    barrier.allowFirst();
    await opening;
    await Bun.sleep(20);

    expect(publications).toHaveLength(1);
    expect(publications[0]?.[0]?.name).toBe("Coalesced change");
    await second.close();
  });

  test("a repair-first failed-prime retry publishes changed rows once", async () => {
    const fixture = makeFixture();
    const first = new ResumeCatalog({ cacheDirectory: fixture.cacheDirectory });
    await openExact(first, fixture.sessionDir);
    await first.close();

    const clonePath = join(fixture.sessionDir, "repair-first.jsonl");
    realFs.writeFileSync(
      clonePath,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: "91000000-0000-7000-8000-000000000003",
        timestamp: "2026-01-01T00:00:03.000Z",
        cwd: join(fixture.sessionDir, ".."),
      })}\n`,
    );
    const second = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    failReadPathOnce = clonePath;
    await expect(second.prime({ sessionDir: fixture.sessionDir })).rejects.toThrow(
      "Injected concurrent file replacement",
    );

    const barrier = createStatBarrier(fixture.sessionPath);
    statBarrier = barrier;
    second.invalidate(fixture.sessionDir);
    await barrier.started;
    const publications: any[][] = [];
    const opening = second.open(
      { sessionDir: fixture.sessionDir },
      (sessions) => {
        publications.push(sessions);
      },
    );
    barrier.allowFirst();
    await opening;
    await Bun.sleep(20);

    expect(publications).toHaveLength(1);
    expect(publications[0]).toHaveLength(2);
    await second.close();
  });

  test("invalidations during reconcile produce no overlap and one follow-up", async () => {
    const fixture = makeFixture();
    const catalog = new ResumeCatalog({
      cacheDirectory: fixture.cacheDirectory,
    });
    await openExact(catalog, fixture.sessionDir);
    realFs.appendFileSync(
      fixture.sessionPath,
      `${JSON.stringify({
        type: "session_info",
        id: "first-change",
        parentId: "large-message",
        timestamp: "2026-01-01T00:00:02.000Z",
        name: "First change",
      })}\n`,
    );

    const barrier = createStatBarrier(fixture.sessionPath);
    statBarrier = barrier;
    catalog.invalidate(fixture.sessionDir, "large.jsonl");
    await barrier.started;
    for (let index = 0; index < 10; index++) {
      catalog.invalidate(fixture.sessionDir, "large.jsonl");
    }
    await Bun.sleep(30);
    const maxActiveBeforeRelease = barrier.maxActive;
    barrier.allowFirst();

    const deadline = Date.now() + 1_000;
    while ((barrier.active > 0 || barrier.calls < 2) && Date.now() < deadline) {
      await Bun.sleep(10);
    }

    expect(maxActiveBeforeRelease).toBe(1);
    expect(barrier.calls).toBeLessThanOrEqual(2);
    await catalog.close();
  });
});
