import { afterAll, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResumeCatalog } from "../../session-catalog";

const root = mkdtempSync(join(tmpdir(), "resume-catalog-multiprocess-test-"));
const childScript = join(import.meta.dir, "fixture", "catalog-watch-child.ts");

async function waitForFiles(paths: string[], timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (paths.every((path) => existsSync(path))) return;
    await Bun.sleep(10);
  }
  throw new Error(`Timed out waiting for ${paths.join(", ")}`);
}

async function openExact(catalog: ResumeCatalog, sessionDir: string) {
  let resolveExact!: (sessions: any[]) => void;
  const exact = new Promise<any[]>((resolve) => {
    resolveExact = resolve;
  });
  const first = await catalog.open({ sessionDir }, resolveExact);
  return catalog.isProvisional(first) ? await exact : first;
}

afterAll(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("ResumeCatalog multi-process refresh", () => {
  test("one append does not make idle processes read the full session", async () => {
    const fixtureRoot = mkdtempSync(join(root, "fixture-"));
    const cacheDirectory = join(fixtureRoot, "cache");
    const sessionDir = join(fixtureRoot, "sessions");
    const signalDirectory = join(fixtureRoot, "signals");
    const sessionPath = join(sessionDir, "large.jsonl");
    mkdirSync(sessionDir);
    mkdirSync(signalDirectory);
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({
          type: "session",
          version: 3,
          id: "92000000-0000-7000-8000-000000000001",
          timestamp: "2026-01-01T00:00:00.000Z",
          cwd: fixtureRoot,
        }),
        JSON.stringify({
          type: "message",
          id: "large-message",
          parentId: null,
          timestamp: "2026-01-01T00:00:01.000Z",
          message: {
            role: "user",
            content: `BEGIN${"x".repeat(4 * 1024 * 1024)}END`,
          },
        }),
        "",
      ].join("\n"),
    );

    const seed = new ResumeCatalog({ cacheDirectory });
    await openExact(seed, sessionDir);
    await seed.close();

    const bun = Bun.which("bun");
    expect(bun).toBeTruthy();
    const children = ["one", "two"].map((id) =>
      Bun.spawn(
        [bun!, childScript, sessionDir, cacheDirectory, signalDirectory, id],
        {
          stderr: "pipe",
          stdout: "pipe",
        },
      ),
    );

    try {
      await waitForFiles(
        children.map((_child, index) =>
          join(signalDirectory, `ready-${index === 0 ? "one" : "two"}`),
        ),
      );
      const appendStart = statSync(sessionPath).size;
      appendFileSync(
        sessionPath,
        `${JSON.stringify({
          type: "session_info",
          id: "tiny-append",
          parentId: "large-message",
          timestamp: "2026-01-01T00:00:02.000Z",
          name: "Changed by active process",
        })}\n`,
      );
      await waitForFiles([
        join(signalDirectory, "updated-one"),
        join(signalDirectory, "updated-two"),
      ]);

      const reads = ["one", "two"].flatMap((id) =>
        readFileSync(join(signalDirectory, `reads-${id}.jsonl`), "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as { start: number; bytes: number }),
      );
      expect(reads).toHaveLength(2);
      expect(reads.every((read) => read.start === appendStart)).toBe(true);
      expect(reads.every((read) => read.bytes < 64 * 1024)).toBe(true);
    } finally {
      for (const child of children) child.kill();
      await Promise.all(children.map((child) => child.exited));
    }
  }, 15_000);
});
