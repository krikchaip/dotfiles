import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

export const EXPECTED_VERSION = process.env.PI_E2E_EXPECT_VERSION ?? "0.84.4";
const POLL_MS = 100;
const READY_TIMEOUT_MS = 12_000;
const COMMAND_TIMEOUT_MS = 10_000;
const root = resolve(import.meta.dir, "../../../..");
export const runDirectory = Bun.spawnSync([
  "mktemp",
  "-d",
  "/tmp/pi-session-topology.XXXXXX",
])
  .stdout.toString()
  .trim();
const completed: string[] = [];

export const CURRENT_ID = "11111111-1111-7111-8111-111111111111";
export const PARENT_ID = "22222222-2222-7222-8222-222222222222";
export const CYCLE_ID = "33333333-3333-7333-8333-333333333333";

type Role = "user" | "assistant";
export type MessageSeed = { role: Role; text: string; id?: string };
export type SessionSeed = {
  id: string;
  path: string;
  cwd: string;
  parentSession?: string;
  name?: string;
  messages?: MessageSeed[];
  recent?: boolean;
};

type StartOptions = {
  extensions: string[];
  session?: SessionSeed;
  sessions?: SessionSeed[];
  ephemeral?: boolean;
  providerDelayMs?: number;
  width?: number;
};

function quote(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

async function execute(
  command: string[],
  allowFailure = false,
): Promise<string> {
  const child = Bun.spawn(command, { stderr: "pipe", stdout: "pipe" });
  let timedOut = false;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const timeout = setTimeout(() => {
    timedOut = true;
    try {
      child.kill();
    } catch {}
    escalation = setTimeout(() => {
      try {
        child.kill(9);
      } catch {}
    }, 1_000);
  }, COMMAND_TIMEOUT_MS);
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  clearTimeout(timeout);
  if (escalation) clearTimeout(escalation);
  if (timedOut) {
    throw new Error(
      `Command timed out after ${COMMAND_TIMEOUT_MS}ms: ${command.join(" ")}`,
    );
  }
  if (status !== 0 && !allowFailure) {
    throw new Error(
      `Command failed (${status}): ${command.join(" ")}\n${stderr || stdout}`,
    );
  }
  return stdout;
}

function messageValue(
  role: Role,
  text: string,
  timestamp: number,
): Record<string, unknown> {
  if (role === "user") {
    return { role, content: [{ type: "text", text }], timestamp };
  }
  return {
    role,
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "session-topology-e2e",
    model: "fake",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp,
  };
}

function writeSession(seed: SessionSeed): void {
  mkdirSync(resolve(seed.path, ".."), { recursive: true });
  const baseTime = seed.recent ? Date.now() - 2_000 : Date.UTC(2025, 0, 1);
  const header: Record<string, unknown> = {
    type: "session",
    version: 3,
    id: seed.id,
    timestamp: new Date(baseTime).toISOString(),
    cwd: seed.cwd,
  };
  if (seed.parentSession) header.parentSession = seed.parentSession;

  const entries: Record<string, unknown>[] = [header];
  let parentId: string | null = null;
  for (const [index, message] of (seed.messages ?? []).entries()) {
    const id = message.id ?? `${seed.id}-message-${index + 1}`;
    const time = baseTime + (index + 1) * 100;
    entries.push({
      type: "message",
      id,
      parentId,
      timestamp: new Date(time).toISOString(),
      message: messageValue(message.role, message.text, time),
    });
    parentId = id;
  }
  if (seed.name) {
    entries.push({
      type: "session_info",
      id: `${seed.id}-name`,
      parentId,
      timestamp: new Date(
        baseTime + ((seed.messages?.length ?? 0) + 1) * 100,
      ).toISOString(),
      name: seed.name,
    });
  }
  writeFileSync(
    seed.path,
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
  );
}

export function readHeader(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8").split("\n")[0] ?? "{}");
}

export class TmuxPi {
  readonly base: string;
  readonly socket: string;
  readonly paneId: string;
  readonly stateDirectory: string;
  readonly sessionDirectory: string;
  readonly workDirectory: string;
  readonly logPath: string;
  readonly providerActivePath: string;
  readonly treeEventPath: string;
  readonly piExecutable: string;
  #statusPath: string;

  private constructor(name: string, paneId: string, piExecutable: string) {
    this.base = join(runDirectory, name);
    this.socket = `${this.base}.tmux.sock`;
    this.paneId = paneId;
    this.stateDirectory = join(this.base, "home", ".pi", "agent");
    this.sessionDirectory = join(this.base, "sessions");
    this.workDirectory = join(this.base, "cwd");
    this.logPath = `${this.base}.ansi`;
    this.providerActivePath = `${this.base}.provider-active`;
    this.treeEventPath = `${this.base}.tree-events`;
    this.piExecutable = piExecutable;
    this.#statusPath = `${this.base}.status`;
  }

  static async start(name: string, options: StartOptions): Promise<TmuxPi> {
    const base = join(runDirectory, name);
    const socket = `${base}.tmux.sock`;
    const statusPath = `${base}.status`;
    const versionPath = `${base}.version`;
    const executablePath = `${base}.executable`;
    const gatePath = `${base}.gate`;
    const launchPath = `${base}.sh`;
    const logPath = `${base}.ansi`;
    const home = join(base, "home");
    const stateDirectory = join(home, ".pi", "agent");
    const sessionDirectory = join(base, "sessions");
    const workDirectory = join(base, "cwd");
    const providerActivePath = `${base}.provider-active`;
    const treeEventPath = `${base}.tree-events`;
    mkdirSync(stateDirectory, { recursive: true });
    mkdirSync(sessionDirectory, { recursive: true });
    mkdirSync(workDirectory, { recursive: true });
    writeFileSync(
      join(stateDirectory, "settings.json"),
      JSON.stringify({
        quietStartup: false,
        branchSummary: { skipPrompt: true },
      }),
    );

    for (const seed of options.sessions ?? []) writeSession(seed);
    if (
      options.session &&
      !(options.sessions ?? []).some(
        (seed) => seed.path === options.session?.path,
      )
    ) {
      writeSession(options.session);
    }

    const piExecutable = Bun.which("pi");
    if (!piExecutable) throw new Error("Pi is not on PATH");
    const command = [
      piExecutable,
      "--verbose",
      "--use-theme",
      "dark",
      ...(options.ephemeral
        ? ["--no-session"]
        : ["--session-dir", sessionDirectory]),
      ...(options.session ? ["--session", options.session.path] : []),
      "--no-context-files",
      "--no-prompt-templates",
      "--no-themes",
      "--no-extensions",
      "--no-skills",
    ];
    const extensions = [
      ...options.extensions,
      "extensions/test/e2e/fixture/session-topology-probe.ts",
      ...(options.providerDelayMs === undefined
        ? []
        : ["extensions/test/e2e/fixture/session-topology-provider.ts"]),
    ];
    for (const extension of extensions)
      command.push("-e", resolve(root, extension));
    if (options.providerDelayMs !== undefined) {
      command.push("--model", "session-topology-e2e/fake");
    }

    const environment: Record<string, string> = {
      COLORTERM: "truecolor",
      COLUMNS: String(options.width ?? 96),
      HOME: home,
      LINES: "36",
      PATH: process.env.PATH ?? "",
      PI_CODING_AGENT_DIR: stateDirectory,
      PI_E2E_PROVIDER_ACTIVE: providerActivePath,
      PI_E2E_PROVIDER_DELAY_MS: String(options.providerDelayMs ?? 0),
      PI_E2E_TREE_EVENT: treeEventPath,
      PI_OFFLINE: "1",
      PI_TELEMETRY: "0",
      TERM: "xterm-256color",
    };
    const assignments = Object.entries(environment)
      .map(([key, value]) => `${key}=${quote(value)}`)
      .join(" ");
    writeFileSync(
      launchPath,
      [
        "#!/bin/sh",
        "set +e",
        `while [ ! -e ${quote(gatePath)} ]; do sleep 0.01; done`,
        `printf '%s\\n' ${quote(piExecutable)} > ${quote(executablePath)}`,
        `${quote(piExecutable)} --version > ${quote(versionPath)}`,
        `env ${assignments} ${command.map(quote).join(" ")}`,
        "status=$?",
        `printf '%s\\n' "$status" > ${quote(statusPath)}`,
        'exit "$status"',
        "",
      ].join("\n"),
    );
    chmodSync(launchPath, 0o700);

    const paneId = (
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
        name,
        "-x",
        String(options.width ?? 96),
        "-y",
        "36",
        "-c",
        workDirectory,
        launchPath,
      ])
    ).trim();
    await execute([
      "tmux",
      "-S",
      socket,
      "pipe-pane",
      "-O",
      "-t",
      paneId,
      `cat > ${quote(logPath)}`,
    ]);
    writeFileSync(gatePath, "go\n");

    const harness = new TmuxPi(name, paneId, piExecutable);
    await harness.waitUntil(
      `Pi ${EXPECTED_VERSION} child version`,
      () =>
        existsSync(versionPath) &&
        readFileSync(versionPath, "utf8").trim() === EXPECTED_VERSION,
    );
    await harness.waitFor(/SESSION TOPOLOGY READY/);
    await harness.waitFor(/0\.0%\/|\$0\.000/);
    harness.assert(
      readFileSync(executablePath, "utf8").trim() === piExecutable,
      "Child Pi executable changed",
    );
    return harness;
  }

  assert(condition: unknown, message: string): void {
    if (!condition) throw new Error(message);
  }

  async tmux(...args: string[]): Promise<string> {
    return execute(["tmux", "-S", this.socket, ...args]);
  }

  async capture(target = this.paneId): Promise<string> {
    return execute(
      [
        "tmux",
        "-S",
        this.socket,
        "capture-pane",
        "-p",
        "-J",
        "-S",
        "-",
        "-t",
        target,
      ],
      true,
    );
  }

  async sendLiteral(text: string, target = this.paneId): Promise<void> {
    await this.tmux("send-keys", "-l", "-t", target, text);
  }

  async sendKeys(...keys: string[]): Promise<void> {
    await this.tmux("send-keys", "-t", this.paneId, ...keys);
  }

  async submitCommand(command: string): Promise<void> {
    await this.sendLiteral(command);
    await Bun.sleep(150);
    await this.sendKeys("Escape", "Enter");
  }

  async submitPrompt(prompt: string): Promise<void> {
    await this.sendLiteral(prompt);
    await this.sendKeys("Enter");
  }

  async waitFor(
    expected: string | RegExp,
    timeoutMs = READY_TIMEOUT_MS,
  ): Promise<string> {
    let pane = "";
    await this.waitUntil(
      `terminal output ${String(expected)}`,
      async () => {
        pane = await this.capture();
        return typeof expected === "string"
          ? pane.includes(expected)
          : expected.test(pane);
      },
      timeoutMs,
    );
    return pane;
  }

  async waitUntil(
    description: string,
    predicate: () => boolean | Promise<boolean>,
    timeoutMs = READY_TIMEOUT_MS,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await Bun.sleep(POLL_MS);
    }
    throw new Error(
      `Timed out waiting for ${description}.\n\nPane:\n${await this.capture()}`,
    );
  }

  treeEventCount(): number {
    if (!existsSync(this.treeEventPath)) return 0;
    return readFileSync(this.treeEventPath, "utf8").split("\n").filter(Boolean)
      .length;
  }

  async paneIds(): Promise<string[]> {
    const output = await execute(
      ["tmux", "-S", this.socket, "list-panes", "-a", "-F", "#{pane_id}"],
      true,
    );
    return output.trim().split("\n").filter(Boolean);
  }

  async windowIds(): Promise<string[]> {
    const output = await execute(
      ["tmux", "-S", this.socket, "list-windows", "-F", "#{window_id}"],
      true,
    );
    return output.trim().split("\n").filter(Boolean);
  }

  async finish(): Promise<void> {
    await this.sendKeys("C-c", "C-c").catch(() => undefined);
    await this.waitUntil("Pi exit", () => existsSync(this.#statusPath), 5_000);
    const status = Number.parseInt(readFileSync(this.#statusPath, "utf8"), 10);
    this.assert(status === 0, `Pi exited with status ${status}`);
    const log = readFileSync(this.logPath, "utf8");
    this.assert(
      !/(Error loading extension|Extension error|Failed to load extension|uncaughtException)/i.test(
        log,
      ),
      `Extension/runtime failure:\n${log}`,
    );
    await execute(["tmux", "-S", this.socket, "kill-server"], true);
  }

  async abort(): Promise<void> {
    await execute(["tmux", "-S", this.socket, "kill-server"], true);
  }
}

export async function scenario(
  name: string,
  run: () => Promise<void>,
): Promise<void> {
  const selected = process.env.PI_E2E_SCENARIO;
  if (selected && selected !== name) return;

  try {
    await run();
    completed.push(name);
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

export function scenarioPaths(name: string) {
  const base = join(runDirectory, name);
  const cwd = join(base, "cwd");
  const sessions = join(base, "sessions");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(sessions, { recursive: true });
  return {
    cwd,
    sessions,
    current: join(sessions, "current.jsonl"),
    parent: join(sessions, "parent.jsonl"),
    cycle: join(sessions, "cycle.jsonl"),
  };
}

export async function withHarness(
  name: string,
  options: StartOptions,
  run: (harness: TmuxPi) => Promise<void>,
): Promise<void> {
  const harness = await TmuxPi.start(name, options);
  try {
    await run(harness);
    await harness.finish();
  } catch (error) {
    await harness.abort();
    throw error;
  }
}

export function reportSuite(name: string): void {
  console.log(
    `PASS ${name} extension baseline (${completed.length} scenarios)`,
  );
  console.log(`PI_VERSION=${EXPECTED_VERSION}`);
  console.log(`PI_PATH=${Bun.which("pi")}`);
}

export async function cleanupSuite(): Promise<void> {
  for (const socket of readdirSync(runDirectory)) {
    if (!socket.endsWith(".tmux.sock")) continue;
    await execute(
      ["tmux", "-S", join(runDirectory, socket), "kill-server"],
      true,
    );
  }
  if (process.env.PI_E2E_KEEP !== "1")
    rmSync(runDirectory, { recursive: true, force: true });
  else console.log(`ARTIFACTS=${runDirectory}`);
}
