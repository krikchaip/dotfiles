import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  cleanupRun,
  makeRunDirectory,
  PiTuiHarness,
} from "../../../../extensions/test/e2e/harness.ts";
import { assert, writeSession } from "./support.ts";

const agentRoot = resolve(import.meta.dir, "../../../..");
const runDirectory = makeRunDirectory(agentRoot);
const name = "resume-cold-all-directories";
const stateDirectory = join(runDirectory, `${name}-state`);
const workDirectory = join(runDirectory, `${name}-cwd`);
const safePath = `--${workDirectory.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
const sessions = join(stateDirectory, "sessions", safePath);
const current = join(sessions, "current.jsonl");
const target = join(sessions, "target.jsonl");
const pending = join(sessions, "pending.jsonl");

function writeDefaultSession(
  path: string,
  id: string,
  title: string,
  body: string,
  second: number,
) {
  writeSession(path, id, title, [body], second);
  const lines = readFileSync(path, "utf8").trimEnd().split("\n");
  const header = JSON.parse(lines[0]!);
  header.cwd = workDirectory;
  lines[0] = JSON.stringify(header);
  writeFileSync(path, `${lines.join("\n")}\n`);
}

function pickerBody(view: string, title: string) {
  const picker = view.slice(view.lastIndexOf(title));
  return picker.split(/\n─{20,}/)[0] ?? picker;
}

let harness: PiTuiHarness | undefined;
try {
  writeDefaultSession(
    current,
    "7e000000-0000-7000-8000-000000000001",
    "Cold All Current",
    "COLD ALL CURRENT BODY",
    1,
  );
  writeDefaultSession(
    target,
    "7e000000-0000-7000-8000-000000000002",
    "Cold All Target",
    "COLD ALL TARGET BODY",
    20,
  );
  mkdirSync(sessions, { recursive: true });
  const fifo = Bun.spawnSync(["mkfifo", pending]);
  assert(fifo.exitCode === 0, "Failed to create the indexing blocker");

  harness = await PiTuiHarness.start({
    name,
    root: agentRoot,
    runDirectory,
    persistSession: true,
    width: 180,
    cliArguments: ["--session", current],
    extensions: ["packages/resume"],
  });

  await harness.submit("/resume");
  await harness.waitFor("Resume Session (Current Folder)");
  await harness.sendKeys("Tab");
  const view = await harness.waitFor("Resume Session (All)");
  const body = pickerBody(view, "Resume Session (All)");
  assert(
    view.includes("Indexing full session history…"),
    `Cold allDirectories scope did not show indexing.\n${view}`,
  );
  assert(
    !body.includes("Cold All Current") && !body.includes("Cold All Target"),
    `Cold allDirectories scope showed rows while indexing.\n${view}`,
  );

  console.log("PASS cold allDirectories scope stays empty while indexing");
} finally {
  await harness?.abort().catch(() => undefined);
  await cleanupRun(runDirectory);
}
