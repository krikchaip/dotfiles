import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  cleanupRun,
  makeRunDirectory,
  PiTuiHarness,
} from "../../../../extensions/test/e2e/harness.ts";
import { assert, writeSession } from "./support.ts";

const agentRoot = resolve(import.meta.dir, "../../../..");
const runDirectory = makeRunDirectory(agentRoot);
const sessions = join(runDirectory, "cold-branch-sessions");
const name = "resume-cold-branch";
const current = join(sessions, "current.jsonl");
const persistedTarget = join(sessions, "persisted-target.jsonl");
const pendingSession = join(sessions, "pending-session.jsonl");
const socket = join(runDirectory, `${name}.tmux.sock`);

async function tmux(...args: string[]): Promise<string> {
  const child = Bun.spawn(["tmux", "-S", socket, ...args], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (status !== 0) throw new Error(stderr || stdout);
  return stdout;
}

async function capture(pane: string): Promise<string> {
  return tmux("capture-pane", "-p", "-J", "-t", pane, "-S", "-");
}

let harness: PiTuiHarness | undefined;
try {
  writeSession(
    current,
    "7b000000-0000-7000-8000-000000000001",
    "Cold Current",
    ["COLD CURRENT BODY"],
    1,
  );
  writeSession(
    persistedTarget,
    "7b000000-0000-7000-8000-000000000002",
    "Cold Persisted Target",
    ["WRONG COLD TITLE", `BEFORE TITLE ${"x".repeat(24 * 1024)}`],
    20,
  );
  appendFileSync(
    persistedTarget,
    `${JSON.stringify({
      type: "message",
      id: "after-title-message",
      parentId: "7b000000-0000-7000-8000-000000000002-name",
      timestamp: "2026-01-01T00:00:24.000Z",
      message: {
        role: "user",
        content: [
          { type: "text", text: `AFTER TITLE ${"y".repeat(24 * 1024)}` },
        ],
        timestamp: Date.parse("2026-01-01T00:00:24.000Z"),
      },
    })}\n`,
  );
  const fifo = Bun.spawnSync(["mkfifo", pendingSession]);
  assert(fifo.exitCode === 0, "Failed to create the cold indexing fixture");

  harness = await PiTuiHarness.start({
    name,
    root: agentRoot,
    runDirectory,
    persistSession: true,
    width: 180,
    cliArguments: ["--session-dir", sessions, "--session", current],
    extensions: ["packages/resume", "extensions/branch-merge.ts"],
  });

  const installedExtensions = join(harness.stateDirectory, "extensions");
  mkdirSync(installedExtensions, { recursive: true });
  writeFileSync(
    join(installedExtensions, "resume.ts"),
    `export { default } from ${JSON.stringify(resolve(agentRoot, "packages/resume/index.ts"))};\n`,
  );
  writeFileSync(
    join(installedExtensions, "branch-merge.ts"),
    `export { default } from ${JSON.stringify(resolve(agentRoot, "extensions/branch-merge.ts"))};\n`,
  );
  await tmux("set-option", "-g", "remain-on-exit", "on");

  await harness.submit("/branch --sp");
  await harness.sendKeys("Enter");
  let childPane = "";
  await harness.waitUntil("cold branch pane", async () => {
    const panes = (await tmux("list-panes", "-a", "-F", "#{pane_id}"))
      .trim()
      .split("\n")
      .filter(Boolean);
    childPane = panes.find((pane) => pane !== harness!.paneId) ?? "";
    return Boolean(childPane);
  });
  let childStartup = "";
  let childReady = false;
  const startupDeadline = Date.now() + 10_000;
  while (Date.now() < startupDeadline) {
    childStartup = await capture(childPane);
    const [dead, status] = (
      await tmux(
        "display-message",
        "-p",
        "-t",
        childPane,
        "#{pane_dead} #{pane_dead_status}",
      )
    )
      .trim()
      .split(" ");
    assert(
      dead !== "1",
      `Cold branch Pi exited with status ${status}.\n${childStartup}`,
    );
    childReady =
      /0\.0%\/|\$0\.000|gpt-|claude|gemini/i.test(childStartup) &&
      /tmux extended-keys is\s+off/.test(childStartup);
    if (childReady) break;
    await Bun.sleep(100);
  }
  assert(childReady, `Cold branch Pi did not become ready.\n${childStartup}`);

  await tmux("send-keys", "-l", "-t", childPane, "/resume");
  await tmux("send-keys", "-t", childPane, "Enter");
  let view = "";
  await harness.waitUntil("cold branch resume picker", async () => {
    view = await capture(childPane);
    return view.includes("Resume Session (Current Folder)");
  });

  const picker = view.slice(view.lastIndexOf("Resume Session (Current Folder)"));
  const [pickerBody = picker] = picker.split(/\n─{20,}/);
  assert(
    view.includes("Indexing full session history…"),
    `Cold branch did not show the indexing message.\n${view}`,
  );
  assert(
    !pickerBody.includes("Cold Current") &&
      !pickerBody.includes("Cold Persisted Target"),
    `Cold branch showed session rows while indexing.\n${view}`,
  );

  await tmux("send-keys", "-t", childPane, "Tab");
  await harness.waitUntil("cold branch All scope", async () => {
    view = await capture(childPane);
    return view.includes("Resume Session (All)");
  }, 2_000);
  const allPicker = view.slice(view.lastIndexOf("Resume Session (All)"));
  const [allPickerBody = allPicker] = allPicker.split(/\n─{20,}/);
  assert(
    view.includes("Indexing full session history…"),
    `Cold All scope cleared the indexing message.\n${view}`,
  );
  assert(
    !allPickerBody.includes("Cold Current") &&
      !allPickerBody.includes("Cold Persisted Target"),
    `Cold All scope showed session rows while indexing.\n${view}`,
  );

  console.log("PASS cold /branch --sp keeps both scopes empty while indexing");
} finally {
  await harness?.abort().catch(() => undefined);
  await cleanupRun(runDirectory);
}
