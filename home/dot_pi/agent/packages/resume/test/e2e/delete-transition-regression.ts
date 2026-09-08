import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  cleanupRun,
  makeRunDirectory,
  PiTuiHarness,
} from "../../../../extensions/test/e2e/harness.ts";
import { assert, makeToolPath, writeSession } from "./support.ts";

const agentRoot = resolve(import.meta.dir, "../../../..");
const runDirectory = makeRunDirectory(agentRoot);
const extension = process.env.RESUME_E2E_EXTENSION ?? "packages/resume";

try {
  mkdirSync(runDirectory, { recursive: true });
  const sessions = join(runDirectory, "delete-transition-sessions");
  const current = join(sessions, "current.jsonl");
  const target = join(sessions, "target.jsonl");
  writeSession(
    current,
    "61500000-0000-7000-8000-000000000001",
    "Delete Transition Current",
    ["DELETE TRANSITION CURRENT BODY"],
    1,
  );
  writeSession(
    target,
    "61500000-0000-7000-8000-000000000002",
    "Delete Transition Target",
    ["DELETE TRANSITION TARGET BODY"],
    20,
  );

  const path = makeToolPath(runDirectory);
  const trash = join(runDirectory, "bin", "trash");
  writeFileSync(trash, '#!/bin/sh\nsleep 0.35\nrm -- "$1"\n');
  chmodSync(trash, 0o700);

  const harness = await PiTuiHarness.start({
    name: "resume-delete-transition",
    root: agentRoot,
    runDirectory,
    persistSession: true,
    cliArguments: ["--session-dir", sessions, "--session", current],
    extensions: [extension],
    environment: { PATH: path },
  });

  try {
    await harness.submitCommand("resume");
    await harness.waitFor("Delete Transition Target");
    await harness.sendLiteral("Delete Transition Target");
    await harness.waitFor("> Delete Transition Target");
    await harness.sendKeys("C-d");
    await harness.waitFor("Delete session?");
    await Bun.sleep(50);
    const actionLogOffset = readFileSync(harness.logPath, "utf8").length;

    await harness.sendKeys("Enter");
    await harness.waitFor("Session moved to trash");
    await Bun.sleep(50);

    const actionBytes = readFileSync(harness.logPath, "utf8").slice(
      actionLogOffset,
    );
    const successIndex = actionBytes.indexOf("Session moved to trash");
    const beforeSuccess = actionBytes.slice(0, successIndex);
    assert(
      !beforeSuccess.includes("Deleting session…"),
      `Delete progress text rendered before success\n\nPTY:\n${actionBytes.replaceAll("\u001b", "<ESC>")}`,
    );
    assert(
      !beforeSuccess.includes("re:<pattern> regex"),
      `Normal key hints rendered before delete success\n\nPTY:\n${actionBytes.replaceAll("\u001b", "<ESC>")}`,
    );
    assert(!existsSync(target), "Confirmed delete left the session file on disk");

    await harness.sendKeys("Escape");
    await harness.waitFor("DELETE TRANSITION CURRENT BODY");
    await harness.finish();
  } finally {
    await harness.abort().catch(() => undefined);
  }

  console.log("PASS resume delete confirmation has a stable progress transition");
} finally {
  await cleanupRun(runDirectory);
}
