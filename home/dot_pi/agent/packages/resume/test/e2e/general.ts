import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  cleanupRun,
  makeRunDirectory,
  PiTuiHarness,
} from "../../../../extensions/test/e2e/harness.ts";
import { assert, writeSession } from "./support.ts";

const agentRoot = resolve(import.meta.dir, "../../../..");
const runDirectory = makeRunDirectory(agentRoot);
const extension = "packages/resume";

async function closeSelector(harness: PiTuiHarness): Promise<void> {
  let stableFrames = 0;
  await harness.sendKeys("Escape");
  await harness.waitUntil("resume selector close", async () => {
    const view = await harness.capture();
    const closed =
      !view.includes("Resume Session (") && !view.includes("Ctrl+R expand");
    stableFrames = closed ? stableFrames + 1 : 0;
    return stableFrames >= 2;
  });
}

async function mutationScenario(): Promise<void> {
  const sessions = join(runDirectory, "mutation-sessions");
  const current = join(sessions, "current.jsonl");
  const target = join(sessions, "target.jsonl");
  writeSession(
    current,
    "10000000-0000-7000-8000-000000000001",
    "Current Mutable",
    ["CURRENT MUTATION BODY"],
    1,
  );
  writeSession(
    target,
    "10000000-0000-7000-8000-000000000002",
    "Target Mutable",
    ["TARGET MUTATION BODY"],
    20,
  );
  const harness = await PiTuiHarness.start({
    name: "resume-mutations",
    root: agentRoot,
    runDirectory,
    persistSession: true,
    cliArguments: ["--session-dir", sessions, "--session", current],
    extensions: [extension],
  });

  try {
    await harness.submitCommand("resume");
    const initialView = await harness.waitFor("Ctrl+R expand");
    assert(
      initialView.includes("Current Mutable"),
      "Resume did not select the active session",
    );

    const beforeDeleteCancel = readFileSync(current, "utf8");
    await harness.sendKeys("C-d");
    await harness.waitFor("Delete session?");
    await harness.sendKeys("Escape");
    await harness.waitFor("Ctrl+R expand");
    assert(
      existsSync(current),
      "Delete cancellation removed the active session",
    );
    assert(
      readFileSync(current, "utf8") === beforeDeleteCancel,
      "Delete cancellation changed active session bytes",
    );

    await harness.sendLiteral("Current Mutable");
    await harness.waitFor("Current Mutable");
    await harness.sendKeys("C-d");
    await harness.waitFor("Delete session?");
    await harness.sendKeys("Enter");
    await harness.waitUntil(
      "active session deletion",
      () => !existsSync(current),
    );
    await harness.waitFor("New session started");
    assert(existsSync(target), "Active deletion removed an unrelated session");
    const remaining = [...new Bun.Glob("*.jsonl").scanSync(sessions)];
    assert(
      !remaining.includes(basename(current)),
      "Deleted active session stayed in the list directory",
    );
    assert(
      remaining.length >= 1,
      "Active deletion did not leave a usable session directory",
    );

    await closeSelector(harness);
    await harness.submitCommand("resume");
    const view = await harness.waitFor("Target Mutable");
    assert(
      !view.includes("Current Mutable"),
      "Deleted active session remained visible after reopening picker",
    );
    await closeSelector(harness);
    await harness.finish();
    console.log(
      "PASS resume active delete cancel/confirm and selector refresh",
    );
    return;
  } finally {
    await harness.abort().catch(() => undefined);
  }
}

async function cacheAndWatcherScenario(): Promise<void> {
  const sessions = join(runDirectory, "watcher-sessions");
  const current = join(sessions, "current.jsonl");
  const watched = join(sessions, "watched.jsonl");
  writeSession(
    current,
    "15000000-0000-7000-8000-000000000001",
    "Cache Current",
    ["CACHE CURRENT"],
    1,
  );
  const harness = await PiTuiHarness.start({
    name: "resume-cache-watcher",
    root: agentRoot,
    runDirectory,
    persistSession: true,
    cliArguments: ["--session-dir", sessions, "--session", current],
    extensions: [extension],
  });
  try {
    await harness.submitCommand("resume");
    await harness.waitFor("Cache Current");
    await closeSelector(harness);

    writeSession(
      watched,
      "15000000-0000-7000-8000-000000000002",
      "Watcher Added",
      ["WATCHER BODY"],
      20,
    );
    await Bun.sleep(350);
    await harness.submitCommand("resume");
    await harness.waitFor("Watcher Added");
    await closeSelector(harness);

    appendFileSync(
      watched,
      `${JSON.stringify({ type: "session_info", id: "watch-rename", parentId: null, timestamp: new Date().toISOString(), name: "Watcher Renamed" })}\n`,
    );
    await Bun.sleep(350);
    await harness.submitCommand("resume");
    await harness.waitFor("Watcher Renamed");
    await closeSelector(harness);

    unlinkSync(watched);
    await Bun.sleep(350);
    await harness.submitCommand("resume");
    const view = await harness.waitFor("Cache Current");
    assert(
      !view.includes("Watcher Renamed"),
      "Removed session remained in the warm cache",
    );
    await closeSelector(harness);
    await harness.finish();
  } finally {
    await harness.abort().catch(() => undefined);
  }
  console.log(
    "PASS resume cold/warm cache and watcher add/change/remove invalidation",
  );
}

async function reloadAndMalformedSessionScenario(): Promise<void> {
  const sessions = join(runDirectory, "reload-sessions");
  const current = join(sessions, "current.jsonl");
  const empty = join(sessions, "empty.jsonl");
  writeSession(
    current,
    "18000000-0000-7000-8000-000000000001",
    "Reload Current",
    ["RELOAD CURRENT BODY"],
    1,
  );
  writeSession(
    empty,
    "18000000-0000-7000-8000-000000000002",
    "Empty Preview",
    [],
    20,
  );
  writeFileSync(join(sessions, "malformed.jsonl"), "not-json\n");
  const harness = await PiTuiHarness.start({
    name: "resume-reload-malformed",
    root: agentRoot,
    runDirectory,
    persistSession: true,
    cliArguments: ["--session-dir", sessions, "--session", current],
    extensions: [extension],
  });

  try {
    await harness.submitCommand("resume");
    await harness.waitFor("Reload Current");
    await closeSelector(harness);
    await harness.submitCommand("reload");
    await harness.waitFor(
      "Reloaded keybindings, extensions, skills, prompts, themes, and context files",
    );
    await harness.submitCommand("resume");
    await harness.waitFor("Reload Current");
    await harness.sendLiteral("Empty Preview");
    await harness.waitFor("Empty Preview");
    await harness.sendKeys("C-r");
    await harness.waitFor("(no preview)");
    await harness.sendKeys("Escape");
    await harness.waitFor("Ctrl+R expand");
    await closeSelector(harness);
    await harness.finish();
  } finally {
    await harness.abort().catch(() => undefined);
  }
  console.log(
    "PASS resume reload, malformed-session tolerance, and empty preview boundary",
  );
}

async function narrowAndNonTmuxScenario(): Promise<void> {
  const sessions = join(runDirectory, "narrow-sessions");
  const current = join(sessions, "current.jsonl");
  writeSession(
    current,
    "20000000-0000-7000-8000-000000000001",
    "A very long current session title for narrow rendering",
    Array.from({ length: 30 }, (_, index) => `NARROW PREVIEW ${index + 1}`),
    1,
  );
  const harness = await PiTuiHarness.start({
    name: "resume-narrow",
    root: agentRoot,
    runDirectory,
    persistSession: true,
    width: 32,
    cliArguments: ["--session-dir", sessions, "--session", current],
    extensions: [extension],
  });
  try {
    await harness.submitCommand("resume");
    let view = await harness.waitFor("Ctrl+R expand");
    assert(view.includes("…"), "Narrow selector did not truncate long content");
    await harness.sendKeys("C-r");
    view = await harness.waitFor("Shift+");
    assert(
      view.includes("Home/End") || view.includes("Shift+"),
      "Expanded narrow preview lost navigation help",
    );
    for (const key of ["S-PPage", "Home", "End", "S-NPage"]) {
      await harness.sendKeys(key);
      await Bun.sleep(120);
    }
    await harness.sendKeys("C-r");
    await harness.waitFor("Ctrl+R expand");
    await closeSelector(harness);
    await harness.finish();
    const log = readFileSync(harness.logPath, "utf8");
    assert(!log.includes("sp ·"), "Non-tmux resume showed tmux split hints");
  } finally {
    await harness.abort().catch(() => undefined);
  }
  console.log("PASS resume narrow preview key matrix and non-tmux hint guard");
}

try {
  mkdirSync(runDirectory, { recursive: true });
  await Promise.all([
    mutationScenario(),
    cacheAndWatcherScenario(),
    reloadAndMalformedSessionScenario(),
    narrowAndNonTmuxScenario(),
  ]);
} finally {
  await cleanupRun(runDirectory);
}
