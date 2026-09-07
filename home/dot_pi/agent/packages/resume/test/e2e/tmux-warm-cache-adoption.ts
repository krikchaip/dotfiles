import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
const sessions = join(runDirectory, "warm-adoption-sessions");
const name = "resume-warm-cache-adoption";
const stateDirectory = join(runDirectory, `${name}-state`);
const cacheVersion = join(stateDirectory, "cache", "resume", "v1");
const current = join(sessions, "current.jsonl");
const target = join(sessions, "target.jsonl");
const pending = join(sessions, "pending.jsonl");
const marker = "Warm Adoption Target";
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
    "7f000000-0000-7000-8000-000000000001",
    "Warm Adoption Current",
    ["WARM ADOPTION CURRENT BODY"],
    1,
  );
  writeSession(
    target,
    "7f000000-0000-7000-8000-000000000002",
    marker,
    ["WARM ADOPTION TARGET BODY"],
    20,
  );
  const writer = new ResumeCatalog({ cacheDirectory: cacheVersion });
  await writer.openExact({ sessionDir: sessions });
  await writer.close();

  harness = await PiTuiHarness.start({
    name,
    root: agentRoot,
    runDirectory,
    persistSession: true,
    width: 180,
    cliArguments: ["--session-dir", sessions, "--session", current],
    extensions: ["packages/resume", "extensions/branch-merge.ts"],
  });

  const installedExtensions = join(stateDirectory, "extensions");
  mkdirSync(installedExtensions, { recursive: true });
  writeFileSync(
    join(installedExtensions, "resume.ts"),
    `export { default } from ${JSON.stringify(resolve(agentRoot, "packages/resume/index.ts"))};\n`,
  );
  writeFileSync(
    join(installedExtensions, "branch-merge.ts"),
    `export { default } from ${JSON.stringify(resolve(agentRoot, "extensions/branch-merge.ts"))};\n`,
  );

  await harness.submit("/resume");
  await harness.waitFor(marker);
  await harness.sendLiteral(marker);
  await harness.sendKeys("Enter");
  await harness.waitUntil("warm target selection", async () => {
    const view = await harness!.capture();
    return !view.includes("Resume Session (Current Folder)") && view.includes(marker);
  });

  const savedCache = join(runDirectory, `${name}-saved-cache`);
  renameSync(cacheVersion, savedCache);
  mkdirSync(cacheVersion, { recursive: true });
  const cacheKey = createHash("sha256").update(sessions).digest("hex");
  writeFileSync(
    join(cacheVersion, `${cacheKey}.json.lock`),
    JSON.stringify({ pid: process.pid, createdAt: Date.now() }),
  );
  const fifo = Bun.spawnSync(["mkfifo", pending]);
  assert(fifo.exitCode === 0, "Failed to create the cold child blocker");

  await harness.submit("/branch --vsp");
  await harness.sendKeys("Enter");
  let childPane = "";
  await harness.waitUntil("warm adoption branch pane", async () => {
    const panes = (await tmux("list-panes", "-a", "-F", "#{pane_id}"))
      .trim()
      .split("\n")
      .filter(Boolean);
    childPane = panes.find((pane) => pane !== harness!.paneId) ?? "";
    return Boolean(childPane);
  });
  await harness.waitUntil("warm adoption branch ready", async () => {
    const view = await capture(childPane);
    return (
      /0\.0%\/|\$0\.000|gpt-|claude|gemini/i.test(view) &&
      /tmux extended-keys is\s+off/.test(view)
    );
  });

  rmSync(cacheVersion, { force: true, recursive: true });
  renameSync(savedCache, cacheVersion);
  const actionLog = join(runDirectory, `${name}-child-resume.ansi`);
  await tmux(
    "pipe-pane",
    "-O",
    "-t",
    childPane,
    `cat > ${JSON.stringify(actionLog)}`,
  );
  await tmux("send-keys", "-l", "-t", childPane, "/resume");
  await tmux("send-keys", "-t", childPane, "Enter");
  let view = "";
  await harness.waitUntil("warm adoption cached picker", async () => {
    view = await capture(childPane);
    return view.includes("Resume Session (Current Folder)") && view.includes(marker);
  });

  const action = readFileSync(actionLog, "utf8");
  assert(
    !action.includes("Indexing full session history…"),
    `Warm cache adoption rendered indexing.\n${view}`,
  );
  console.log("PASS branch child adopts cache created after startup");
} finally {
  await harness?.abort().catch(() => undefined);
  await cleanupRun(runDirectory);
}
