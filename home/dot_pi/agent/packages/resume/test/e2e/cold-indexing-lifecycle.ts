import {
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  cleanupRun,
  makeRunDirectory,
  PiTuiHarness,
} from "../../../../extensions/test/e2e/harness.ts";
import { assert, writeSession } from "./support.ts";

const agentRoot = resolve(import.meta.dir, "../../../..");
const runDirectory = makeRunDirectory(agentRoot);
const name = "resume-cold-indexing-lifecycle";
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
    "7d000000-0000-7000-8000-000000000001",
    "Cold Lifecycle Current",
    "COLD LIFECYCLE CURRENT BODY",
    1,
  );
  writeDefaultSession(
    target,
    "7d000000-0000-7000-8000-000000000002",
    "Cold Lifecycle Target",
    "COLD LIFECYCLE TARGET BODY",
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
  let view = await harness.waitFor("Resume Session (Current Folder)");
  let body = pickerBody(view, "Resume Session (Current Folder)");
  assert(
    view.includes("Indexing full session history…"),
    `Cold default scope did not show indexing.\n${view}`,
  );
  assert(
    !body.includes("Cold Lifecycle Current") &&
      !body.includes("Cold Lifecycle Target"),
    `Cold default scope showed rows while indexing.\n${view}`,
  );

  writeFileSync(pending, "{}\n");
  unlinkSync(pending);
  await harness.waitUntil("exact catalog publication", async () => {
    view = await harness!.capture();
    return (
      view.includes("Resume Session (Current Folder)") &&
      view.includes("Cold Lifecycle Target") &&
      !view.includes("Indexing full session history…")
    );
  });

  console.log("PASS cold default catalog publishes exact rows after indexing");
} finally {
  await harness?.abort().catch(() => undefined);
  await cleanupRun(runDirectory);
}
