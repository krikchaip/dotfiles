import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  cleanupRun,
  makeRunDirectory,
  PiTuiHarness,
} from "../../../../extensions/test/e2e/harness.ts";
import { assert, makeToolPath, writeSession } from "./support.ts";

const agentRoot = resolve(import.meta.dir, "../../../..");
const runDirectory = makeRunDirectory(agentRoot);
const extension = "packages/resume";

async function renameOwnershipRegression(): Promise<void> {
  const sessions = join(runDirectory, "known-red-rename-sessions");
  const current = join(sessions, "current.jsonl");
  writeSession(
    current,
    "61000000-0000-7000-8000-000000000001",
    "Rename Ownership",
    ["RENAME OWNERSHIP BODY"],
    1,
  );
  const harness = await PiTuiHarness.start({
    name: "known-red-resume-rename",
    root: agentRoot,
    runDirectory,
    persistSession: true,
    cliArguments: ["--session-dir", sessions, "--session", current],
    extensions: [extension],
  });

  try {
    await harness.submitCommand("resume");
    await harness.waitFor("Ctrl+R expand");
    await harness.sendKeys("C-r");
    await Bun.sleep(350);
    const view = await harness.capture();
    assert(
      view.includes("Rename Session"),
      "Ctrl+R is owned by the preview and Pi session rename is unreachable",
    );
  } finally {
    await harness.abort().catch(() => undefined);
  }
}

async function activeDeleteFailureRegression(): Promise<void> {
  const sessions = join(runDirectory, "known-red-delete-sessions");
  const current = join(sessions, "current.jsonl");
  writeSession(
    current,
    "62000000-0000-7000-8000-000000000001",
    "Delete Failure Active",
    ["DELETE FAILURE BODY"],
    1,
  );
  const harness = await PiTuiHarness.start({
    name: "known-red-resume-delete",
    root: agentRoot,
    runDirectory,
    persistSession: true,
    cliArguments: ["--session-dir", sessions, "--session", current],
    extensions: [extension],
    environment: { PATH: makeToolPath(runDirectory) },
  });

  try {
    await harness.submitCommand("resume");
    await harness.waitFor("Delete Failure Active");
    chmodSync(sessions, 0o500);
    await harness.sendKeys("C-d");
    await harness.waitFor("Delete session?");
    await harness.sendKeys("Enter");
    await Bun.sleep(500);
    const view = await harness.capture();
    assert(
      existsSync(current),
      "Failure fixture unexpectedly removed the active session file",
    );
    assert(
      view.includes("Failed to delete:") &&
        view.includes("Ctrl+R expand") &&
        view.includes("Delete Failure Active"),
      "failed active deletion starts a new session and hides the exact error instead of preserving the picker",
    );
  } finally {
    chmodSync(sessions, 0o700);
    await harness.abort().catch(() => undefined);
  }
}

const failures: Error[] = [];

try {
  mkdirSync(runDirectory, { recursive: true });
  for (const [name, scenario] of [
    ["Ctrl+R rename ownership", renameOwnershipRegression],
    ["active delete failure safety", activeDeleteFailureRegression],
  ] as const) {
    try {
      await scenario();
      console.log(`PASS resolved regression: ${name}`);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      failures.push(failure);
      console.error(`KNOWN RED ${name}: ${failure.message}`);
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `${failures.length} known resume regression(s) remain`,
    );
  }
} finally {
  await cleanupRun(runDirectory);
}
