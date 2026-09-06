import { mock } from "bun:test";
import * as realFs from "node:fs";
import { join } from "node:path";

const [sessionDir, cacheDirectory, signalDirectory, childId] =
  process.argv.slice(2);
if (!sessionDir || !cacheDirectory || !signalDirectory || !childId) {
  throw new Error(
    "Expected sessionDir, cacheDirectory, signalDirectory, and childId",
  );
}

const observedPath = join(sessionDir, "large.jsonl");
const readLog = join(signalDirectory, `reads-${childId}.jsonl`);
const originalCreateReadStream = realFs.createReadStream;
let observeReads = false;

mock.module("node:fs", () => ({
  ...realFs,
  createReadStream(
    path: realFs.PathLike,
    options?: Parameters<typeof realFs.createReadStream>[1],
  ) {
    const stream = originalCreateReadStream(path, options as any);
    if (observeReads && String(path) === observedPath) {
      const record = {
        start:
          typeof options === "object" &&
          options &&
          typeof options.start === "number"
            ? options.start
            : 0,
        bytes: 0,
      };
      stream.on("data", (chunk) => {
        record.bytes += Buffer.byteLength(chunk);
      });
      stream.on("end", () => {
        realFs.appendFileSync(readLog, `${JSON.stringify(record)}\n`);
      });
    }
    return stream;
  },
}));

const { ResumeCatalog } =
  await import("../../../session-catalog.ts?watch-child");
const catalog = new ResumeCatalog({ cacheDirectory });
await catalog.open({ sessionDir }, () => {
  realFs.writeFileSync(
    join(signalDirectory, `updated-${childId}`),
    "updated\n",
  );
});

const watcher = realFs.watch(
  sessionDir,
  { persistent: false },
  (_event, filename) => {
    if (filename && String(filename).endsWith(".jsonl")) {
      catalog.invalidate(sessionDir, String(filename));
    }
  },
);
observeReads = true;
realFs.writeFileSync(join(signalDirectory, `ready-${childId}`), "ready\n");

const stop = async () => {
  watcher.close();
  await catalog.close();
  process.exit(0);
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
await new Promise(() => {});
