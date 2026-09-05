import {
  closeSync,
  fsyncSync,
  openSync,
  statSync,
  watch,
  writeFileSync,
  writeSync,
} from "node:fs";
import { basename, dirname } from "node:path";

const [targetPath, readyPath, outcomePath, entry] = process.argv.slice(2);
if (!targetPath || !readyPath || !outcomePath || !entry) {
  throw new Error(
    "Usage: parent-concurrent-watcher.ts <target> <ready> <outcome> <entry>",
  );
}

const initial = statSync(targetPath);
const targetName = basename(targetPath);
const appendFd = openSync(targetPath, "a");
let finished = false;
let timeout: ReturnType<typeof setTimeout>;
let identityPoll: ReturnType<typeof setInterval>;

function finish(outcome: string, exitCode: number) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  clearInterval(identityPoll);
  watcher.close();
  closeSync(appendFd);
  writeFileSync(outcomePath, `${outcome}\n`);
  process.exitCode = exitCode;
}

function inject(trigger: "temp-observed" | "replacement-observed") {
  if (finished) return;
  try {
    // Keep the descriptor open from before the rewrite. If rename wins the
    // scheduling race, this still models an active writer and exposes the lost
    // append on the replaced inode.
    writeSync(appendFd, `${entry}\n`);
    fsyncSync(appendFd);
    finish(`appended-via-${trigger}`, 0);
  } catch (error) {
    finish(
      `append-failed:${error instanceof Error ? error.message : String(error)}`,
      3,
    );
  }
}

const watcher = watch(dirname(targetPath), (_event, filename) => {
  if (finished || typeof filename !== "string") return;
  if (
    filename.startsWith(`${targetName}.parent-`) &&
    filename.endsWith(".tmp")
  ) {
    inject("temp-observed");
  }
});
watcher.on("error", (error) => finish(`watch-failed:${error.message}`, 4));

// Directory events can be coalesced on a busy machine. The inode check is a
// deterministic fallback after the atomic replace.
identityPoll = setInterval(() => {
  if (finished) return;
  try {
    const current = statSync(targetPath);
    if (current.dev !== initial.dev || current.ino !== initial.ino) {
      inject("replacement-observed");
    }
  } catch {}
}, 5);

timeout = setTimeout(
  () => finish("timed-out-before-observing-rewrite", 2),
  5_000,
);

process.on("SIGTERM", () => finish("terminated", 143));
process.on("SIGINT", () => finish("interrupted", 130));
writeFileSync(readyPath, "ready\n");
