import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  cleanupRun,
  makeRunDirectory,
  PiTuiHarness,
} from "../../../../extensions/test/e2e/harness.ts";
import { ResumeCatalog } from "../../session-catalog.ts";
import { assert, writeSession } from "./support.ts";

const agentRoot = resolve(import.meta.dir, "../../../..");
const runDirectory = makeRunDirectory(agentRoot);
const name = "resume-partial-cache";
const stateDirectory = join(runDirectory, `${name}-state`);
const sessions = join(runDirectory, "partial-cache-sessions");
const cachedSession = join(sessions, "cached.jsonl");
const currentSession = join(sessions, "current.jsonl");
const uncachedSession = join(sessions, "uncached.jsonl");
const pendingSession = join(sessions, "pending.jsonl");

async function seedPersistedCatalog(): Promise<void> {
  const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = stateDirectory;
  try {
    const catalog = new ResumeCatalog();
    try {
      let resolveExact!: () => void;
      const exact = new Promise<void>((resolve) => {
        resolveExact = resolve;
      });
      const first = await catalog.open({ sessionDir: sessions }, (rows) => {
        if (!catalog.isProvisional(rows)) resolveExact();
      });
      if (!catalog.isProvisional(first)) resolveExact();
      await exact;
    } finally {
      await catalog.close();
    }
  } finally {
    if (previousAgentDirectory === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
    }
  }
}

let harness: PiTuiHarness | undefined;
try {
  writeSession(
    cachedSession,
    "7c000000-0000-7000-8000-000000000001",
    "Cached Session",
    ["CACHED SESSION BODY"],
    1,
  );
  await seedPersistedCatalog();

  writeSession(
    currentSession,
    "7c000000-0000-7000-8000-000000000002",
    "Current Uncached Session",
    ["CURRENT UNCACHED BODY"],
    20,
  );
  writeSession(
    uncachedSession,
    "7c000000-0000-7000-8000-000000000003",
    "Other Uncached Session",
    ["OTHER UNCACHED BODY"],
    30,
  );
  mkdirSync(sessions, { recursive: true });
  const fifo = Bun.spawnSync(["mkfifo", pendingSession]);
  assert(fifo.exitCode === 0, "Failed to create the indexing blocker");

  harness = await PiTuiHarness.start({
    name,
    root: agentRoot,
    runDirectory,
    persistSession: true,
    width: 180,
    cliArguments: [
      "--session-dir",
      sessions,
      "--session",
      currentSession,
    ],
    extensions: ["packages/resume"],
  });

  await harness.submit("/resume");
  const view = await harness.waitFor("Resume Session (Current Folder)");
  const picker = view.slice(view.lastIndexOf("Resume Session (Current Folder)"));
  const [pickerBody = picker] = picker.split(/\n─{20,}/);

  assert(
    pickerBody.includes("Cached Session"),
    `Partial cache did not show its persisted session.\n${view}`,
  );
  assert(
    !view.includes("Indexing full session history…"),
    `Partial cache showed the indexing message.\n${view}`,
  );

  console.log("PASS partial cache renders immediately without indexing status");
} finally {
  await harness?.abort().catch(() => undefined);
  await cleanupRun(runDirectory);
}
