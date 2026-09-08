import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  cleanupRun,
  makeRunDirectory,
  PiTuiHarness,
} from "../../../../extensions/test/e2e/harness.ts";
import { ResumeCatalog } from "../../session-catalog.ts";
import { assert, makeToolPath, writeSession } from "./support.ts";

const agentRoot = resolve(import.meta.dir, "../../../..");
const runDirectory = makeRunDirectory(agentRoot);
const name = "resume-delete-reconciliation";
const stateDirectory = join(runDirectory, `${name}-state`);
const sessions = join(runDirectory, "delete-reconciliation-sessions");
const current = join(sessions, "current.jsonl");
const target = join(sessions, "old.jsonl");

async function seedPersistedCatalog(): Promise<void> {
  const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = stateDirectory;
  try {
    const catalog = new ResumeCatalog();
    try {
      await catalog.openExact({ sessionDir: sessions });
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

async function closeSelector(harness: PiTuiHarness): Promise<void> {
  await harness.sendKeys("Escape");
  await harness.waitUntil("resume selector close", async () => {
    const view = await harness.capture();
    return (
      !view.includes("Resume Session (") && !view.includes("Ctrl+R expand")
    );
  });
}

let harness: PiTuiHarness | undefined;
try {
  mkdirSync(runDirectory, { recursive: true });
  writeSession(
    current,
    "63000000-0000-7000-8000-000000000001",
    "Current Session",
    ["CURRENT SESSION BODY"],
    30,
  );
  writeSession(
    target,
    "63000000-0000-7000-8000-000000000002",
    "Old Session",
    ["OLD SESSION BODY"],
    1,
  );
  await seedPersistedCatalog();

  harness = await PiTuiHarness.start({
    name,
    root: agentRoot,
    runDirectory,
    persistSession: true,
    cliArguments: ["--session-dir", sessions, "--session", current],
    extensions: ["packages/resume"],
    environment: { PATH: makeToolPath(runDirectory) },
  });

  await harness.submitCommand("resume");
  await harness.waitFor("Old Session");
  appendFileSync(target, "\n");
  await harness.waitUntil("catalog reconciliation reads old session", () => {
    const result = Bun.spawnSync(["lsof", "-t", "--", target], {
      stdout: "pipe",
      stderr: "ignore",
    });
    return result.exitCode === 0 && result.stdout.length > 0;
  });
  await harness.sendKeys("Down");
  await harness.waitFor(/›\s+Old Session/);
  await harness.sendKeys("C-d");
  await harness.waitFor("Delete session?");
  await harness.sendKeys("Enter");
  await harness.waitUntil("old session file deletion", () => !existsSync(target));
  await Bun.sleep(300);

  let view = await harness.capture();
  const staleWhileOpen = view.includes("Old Session");

  await closeSelector(harness);
  await harness.submitCommand("resume");
  await harness.waitFor("Ctrl+R expand");
  await Bun.sleep(300);
  view = await harness.capture();
  const staleAfterReopen = view.includes("Old Session");

  await closeSelector(harness);
  await harness.finish();

  assert(
    !staleWhileOpen && !staleAfterReopen,
    `Deleted old session remained visible before and/or after reopening /resume.\n\n${view}`,
  );
  console.log("PASS deleted session stays absent during catalog reconciliation");
} finally {
  await harness?.abort().catch(() => undefined);
  await cleanupRun(runDirectory);
}
