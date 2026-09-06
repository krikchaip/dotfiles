import { join, resolve } from "node:path";
import {
  cleanupRun,
  makeRunDirectory,
  PiTuiHarness,
} from "../../../../extensions/test/e2e/harness.ts";
import { assert, writeSession } from "./support.ts";

const agentRoot = resolve(import.meta.dir, "../../../..");
const runDirectory = makeRunDirectory(agentRoot);
const sessions = join(runDirectory, "tmux-prime-sessions");
const name = "resume-tmux-prime";
const current = join(sessions, "current.jsonl");
const persistedTarget = join(sessions, "persisted-target.jsonl");
const pendingClone = join(sessions, "pending-clone.jsonl");

async function closeSelector(harness: PiTuiHarness): Promise<void> {
  await harness.sendKeys("Escape");
  await harness.waitUntil("resume selector close", async () => {
    const view = await harness.capture();
    return !view.includes("Resume Session (");
  });
}

async function startHarness(): Promise<PiTuiHarness> {
  return PiTuiHarness.start({
    name,
    root: agentRoot,
    runDirectory,
    persistSession: true,
    cliArguments: ["--session-dir", sessions, "--session", current],
    extensions: ["packages/resume"],
  });
}

let first: PiTuiHarness | undefined;
let second: PiTuiHarness | undefined;
try {
  writeSession(
    current,
    "7a000000-0000-7000-8000-000000000001",
    "Prime Current",
    ["PRIME CURRENT BODY"],
    1,
  );
  writeSession(
    persistedTarget,
    "7a000000-0000-7000-8000-000000000002",
    "Persisted Target",
    ["PERSISTED TARGET BODY"],
    20,
  );

  first = await startHarness();
  await first.submitCommand("resume");
  await first.waitFor("Persisted Target");
  await closeSelector(first);
  await first.finish();
  await first.abort().catch(() => undefined);
  first = undefined;

  const fifo = Bun.spawnSync(["mkfifo", pendingClone]);
  assert(fifo.exitCode === 0, "Failed to create the pending clone fixture");

  second = await startHarness();
  await second.submitCommand("resume");
  const view = await second.waitFor("Resume Session (Current Folder)");
  assert(
    view.includes("Persisted Target"),
    `Fresh tmux target hid persisted sessions while a new file indexed.\n${view}`,
  );
  assert(
    !view.includes("Indexing…"),
    "Fresh tmux target showed indexing despite having persisted sessions",
  );

  await closeSelector(second);
  const unblock = Bun.spawn([
    "sh",
    "-c",
    `printf '\\n' > "$1"`,
    "sh",
    pendingClone,
  ]);
  await unblock.exited;
  await second.finish();
  second = undefined;

  console.log(
    "PASS resume fresh tmux target keeps persisted sessions visible during reconciliation",
  );
} finally {
  await first?.abort().catch(() => undefined);
  await second?.abort().catch(() => undefined);
  await cleanupRun(runDirectory);
}
