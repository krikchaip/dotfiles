import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const EXPECTED_VERSION = process.env.PI_E2E_EXPECT_VERSION ?? "0.84.4";
const POLL_MS = 100;
const root = resolve(import.meta.dir, "../..");
const extension = join(root, "index.ts");
const runDirectory = `/tmp/resume-e2e-${process.pid}`;
const socket = join(runDirectory, "tmux.sock");
const paneLog = join(runDirectory, "pi.ansi");
const pipeDone = join(runDirectory, "pi.ansi.done");
const statusFile = join(runDirectory, "pi.status");
const gateFile = join(runDirectory, "start.gate");
const launchFile = join(runDirectory, "launch.sh");
const home = join(runDirectory, "home");
const agentDir = join(home, ".pi", "agent");
const workDir = join(runDirectory, "cwd");
const sessionDir = join(runDirectory, "sessions");
const currentSession = join(sessionDir, "current.jsonl");
const targetSession = join(sessionDir, "target.jsonl");

function quote(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

async function execute(
  command: string[],
  allowFailure = false,
): Promise<string> {
  const child = Bun.spawn(command, { stderr: "pipe", stdout: "pipe" });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (status !== 0 && !allowFailure) {
    throw new Error(
      `Command failed (${status}): ${command.join(" ")}\n${stderr || stdout}`,
    );
  }
  return stdout;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function tmux(...args: string[]): Promise<string> {
  return execute(["tmux", "-S", socket, ...args]);
}

async function capture(pane: string): Promise<string> {
  return execute(
    ["tmux", "-S", socket, "capture-pane", "-p", "-J", "-S", "-", "-t", pane],
    true,
  );
}

async function waitUntil(
  description: string,
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 12_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await Bun.sleep(POLL_MS);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function waitForPane(
  pane: string,
  text: string,
  timeoutMs = 12_000,
): Promise<string> {
  let view = "";
  await waitUntil(
    `terminal text ${JSON.stringify(text)}`,
    async () => {
      view = await capture(pane);
      return view.includes(text);
    },
    timeoutMs,
  );
  return view;
}

async function sendText(
  pane: string,
  text: string,
  enter = false,
): Promise<void> {
  await tmux("send-keys", "-l", "-t", pane, text);
  if (enter) await tmux("send-keys", "-t", pane, "Enter");
}

function entryTimestamp(offsetSeconds: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, offsetSeconds)).toISOString();
}

function writeSession(
  path: string,
  id: string,
  name: string,
  messages: string[],
  startSecond: number,
): void {
  const entries: unknown[] = [
    {
      type: "session",
      version: 3,
      id,
      timestamp: entryTimestamp(startSecond),
      cwd: workDir,
    },
  ];
  let parentId: string | null = null;
  messages.forEach((text, index) => {
    const messageId = `${id}-message-${index + 1}`;
    const timestamp = entryTimestamp(startSecond + index + 1);
    entries.push({
      type: "message",
      id: messageId,
      parentId,
      timestamp,
      message: {
        role: "user",
        content: [{ type: "text", text }],
        timestamp: Date.parse(timestamp),
      },
    });
    parentId = messageId;
  });
  entries.push({
    type: "session_info",
    id: `${id}-name`,
    parentId,
    timestamp: entryTimestamp(startSecond + messages.length + 1),
    name,
  });
  writeFileSync(
    path,
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
  );
}

function previewRange(view: string): string | undefined {
  return view.match(/(\d+-\d+\/\d+) · Shift\+/)?.[1];
}

async function main(): Promise<void> {
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    join(agentDir, "settings.json"),
    JSON.stringify({ quietStartup: false, theme: "dark" }),
  );
  writeFileSync(
    join(agentDir, "keybindings.json"),
    JSON.stringify({ "app.session.resume": ["alt+r"] }),
  );

  writeSession(
    currentSession,
    "00000000-0000-7000-8000-000000000001",
    "Current Session",
    ["CURRENT_SESSION_BODY"],
    1,
  );
  writeSession(
    targetSession,
    "00000000-0000-7000-8000-000000000002",
    "Target Session",
    Array.from(
      { length: 24 },
      (_, index) => `TARGET_PREVIEW_BODY_${String(index + 1).padStart(2, "0")}`,
    ),
    100,
  );
  writeSession(
    join(sessionDir, "other.jsonl"),
    "00000000-0000-7000-8000-000000000003",
    "Other Session",
    ["OTHER_SESSION_BODY"],
    50,
  );

  const pi = Bun.which("pi");
  assert(pi, "Pi is not on PATH.");
  const piExecutable = realpathSync(pi);
  const version = (await execute([piExecutable, "--version"])).trim();
  assert(
    version === EXPECTED_VERSION,
    `Expected Pi ${EXPECTED_VERSION}, got ${version}.`,
  );

  const args = [
    "--verbose",
    "--use-theme",
    "dark",
    "--session-dir",
    sessionDir,
    "--session",
    currentSession,
    "--no-context-files",
    "--no-prompt-templates",
    "--no-themes",
    "--no-skills",
    "--no-extensions",
    "-e",
    extension,
  ];
  const assignments = {
    COLORTERM: "truecolor",
    COLUMNS: "96",
    HOME: home,
    LINES: "36",
    PI_CODING_AGENT_DIR: agentDir,
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
    TERM: "xterm-256color",
  };
  const environment = Object.entries(assignments)
    .map(([key, value]) => `${key}=${quote(value)}`)
    .join(" ");

  writeFileSync(
    launchFile,
    [
      "#!/bin/sh",
      "set +e",
      `while [ ! -e ${quote(gateFile)} ]; do sleep 0.01; done`,
      `printf '__PI_EXECUTABLE__=%s\\n' ${quote(piExecutable)}`,
      `version=$(${quote(piExecutable)} --version)`,
      `printf '__PI_VERSION__=%s\\n' "$version"`,
      `env ${environment} ${quote(piExecutable)} ${args.map(quote).join(" ")}`,
      "status=$?",
      `printf '%s\\n' "$status" > ${quote(statusFile)}`,
      'exit "$status"',
      "",
    ].join("\n"),
  );
  chmodSync(launchFile, 0o700);

  const pane = (
    await execute([
      "tmux",
      "-S",
      socket,
      "-f",
      "/dev/null",
      "new-session",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-s",
      "resume-e2e",
      "-x",
      "96",
      "-y",
      "36",
      "-c",
      workDir,
      launchFile,
    ])
  ).trim();
  await tmux(
    "pipe-pane",
    "-O",
    "-t",
    pane,
    `cat > ${quote(paneLog)}; : > ${quote(pipeDone)}`,
  );
  writeFileSync(gateFile, "go\n");

  await waitForPane(pane, "[Extensions]");
  await sendText(pane, "/resume", true);
  let view = await waitForPane(pane, "Ctrl+R expand");
  assert(
    view.includes("Current Session"),
    `Resume did not open on the active session.\n${view}`,
  );
  assert(
    !view.includes("TARGET_PREVIEW_BODY_24"),
    "Collapsed preview exposed full session content.",
  );

  await sendText(pane, "Target");
  view = await waitForPane(pane, "Target Session");
  assert(
    view.includes("Ctrl+R expand"),
    "Search result lost the collapsed preview hint.",
  );

  await tmux("send-keys", "-H", "-t", pane, "12");
  view = await waitForPane(pane, "TARGET_PREVIEW_BODY_24");
  await waitForPane(pane, "Shift+↑/↓ scroll");
  const initialRange = previewRange(view);
  assert(initialRange, `Expanded preview did not show a range.\n${view}`);

  await tmux("send-keys", "-H", "-t", pane, "1b", "5b", "31", "3b", "32", "41");
  let scrolledView = "";
  await waitUntil("expanded preview to scroll up", async () => {
    scrolledView = await capture(pane);
    const nextRange = previewRange(scrolledView);
    return Boolean(nextRange && nextRange !== initialRange);
  });
  assert(
    scrolledView.includes("Shift+↑/↓ scroll"),
    "Scroll removed expanded preview controls.",
  );

  await tmux("send-keys", "-H", "-t", pane, "1b");
  view = await waitForPane(pane, "Ctrl+R expand");
  assert(
    !view.includes("Shift+↑/↓ scroll"),
    "Escape did not collapse the preview.",
  );

  await tmux("send-keys", "-t", pane, "Enter");
  view = await waitForPane(pane, "TARGET_PREVIEW_BODY_24");
  assert(
    !view.includes("Ctrl+R expand"),
    "Selecting the target left the resume selector open.",
  );
  assert(
    readFileSync(targetSession, "utf8").includes("Target Session"),
    "Selecting the session changed its stored name.",
  );

  await tmux("send-keys", "-t", pane, "C-d");
  await waitUntil("Pi process exit", () => existsSync(statusFile), 5_000);
  await waitUntil("terminal pipe flush", () => existsSync(pipeDone), 5_000);
  const status = Number.parseInt(readFileSync(statusFile, "utf8"), 10);
  assert(status === 0, `Pi exited with status ${status}.`);

  const log = readFileSync(paneLog, "utf8");
  assert(
    log.includes(`__PI_EXECUTABLE__=${piExecutable}`),
    "Raw PTY log does not identify the child Pi executable.",
  );
  assert(
    log.includes(`__PI_VERSION__=${EXPECTED_VERSION}`),
    "Raw PTY log does not identify the child Pi version.",
  );
  assert(
    !/(Failed to load|Extension error|uncaughtException)/i.test(log),
    "Raw PTY log contains an extension/runtime failure.",
  );

  console.log(
    "PASS resume real-TUI E2E: active-session selection, search, collapsed preview, expanded preview, scrolling, collapse, and target selection",
  );
  console.log(`PI_VERSION=${EXPECTED_VERSION}`);
  console.log(`PI_PATH=${piExecutable}`);
}

try {
  await main();
} finally {
  await execute(["tmux", "-S", socket, "kill-server"], true).catch(
    () => undefined,
  );
  if (process.env.KEEP_E2E_ARTIFACTS !== "1")
    rmSync(runDirectory, { force: true, recursive: true });
  else console.log(`ARTIFACTS=${runDirectory}`);
}
