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

const EXPECTED_VERSION = process.env.PI_E2E_EXPECT_VERSION ?? "0.84.4";
const POLL_MS = 100;
const READY_TIMEOUT_MS = 10_000;
const COMMAND_TIMEOUT_MS = 10_000;

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

export interface HarnessOptions {
  name: string;
  root: string;
  runDirectory: string;
  extensions: string[];
  skills?: string[];
  model?: string;
  cliArguments?: string[];
  persistSession?: boolean;
  width?: number;
  settings?: Record<string, unknown>;
  environment?: Record<string, string>;
}

export class PiTuiHarness {
  readonly stateDirectory: string;
  readonly workDirectory: string;
  readonly logPath: string;
  readonly paneId: string;

  #socket: string;
  #statusPath: string;

  private constructor(
    private readonly options: HarnessOptions,
    paneId: string,
    socket: string,
  ) {
    this.paneId = paneId;
    this.#socket = socket;
    this.stateDirectory = join(options.runDirectory, `${options.name}-state`);
    this.workDirectory = join(options.runDirectory, `${options.name}-cwd`);
    this.logPath = join(options.runDirectory, `${options.name}.ansi`);
    this.#statusPath = join(options.runDirectory, `${options.name}.status`);
  }

  static async start(options: HarnessOptions): Promise<PiTuiHarness> {
    const stateDirectory = join(options.runDirectory, `${options.name}-state`);
    const workDirectory = join(options.runDirectory, `${options.name}-cwd`);
    const homeDirectory = join(options.runDirectory, `${options.name}-home`);
    const logPath = join(options.runDirectory, `${options.name}.ansi`);
    const statusPath = join(options.runDirectory, `${options.name}.status`);
    const versionPath = join(options.runDirectory, `${options.name}.version`);
    const executablePath = join(
      options.runDirectory,
      `${options.name}.executable`,
    );
    const gatePath = join(options.runDirectory, `${options.name}.gate`);
    const launchPath = join(options.runDirectory, `${options.name}-launch.sh`);
    const socket = join(options.runDirectory, `${options.name}.tmux.sock`);

    mkdirSync(stateDirectory, { recursive: true });
    mkdirSync(workDirectory, { recursive: true });
    mkdirSync(homeDirectory, { recursive: true });
    if (options.settings) {
      writeFileSync(
        join(stateDirectory, "settings.json"),
        JSON.stringify(options.settings),
      );
    }

    const piExecutable = Bun.which("pi");
    if (!piExecutable) throw new Error("Pi is not on PATH.");

    const command = [
      piExecutable,
      "--verbose",
      "--use-theme",
      "dark",
      ...(options.persistSession ? [] : ["--no-session"]),
      "--no-context-files",
      "--no-prompt-templates",
      "--no-themes",
      "--no-extensions",
      "--no-skills",
    ];
    for (const extension of options.extensions) {
      command.push("-e", resolve(options.root, extension));
    }
    for (const skill of options.skills ?? []) {
      command.push("--skill", resolve(options.root, skill));
    }
    if (options.model) command.push("--model", options.model);
    command.push(...(options.cliArguments ?? []));

    const environment = {
      COLORTERM: "truecolor",
      COLUMNS: String(options.width ?? 90),
      HOME: homeDirectory,
      LINES: "32",
      PI_CODING_AGENT_DIR: stateDirectory,
      PI_OFFLINE: "1",
      PI_TELEMETRY: "0",
      TERM: "xterm-256color",
      ...options.environment,
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
        options.name,
        "-x",
        String(options.width ?? 90),
        "-y",
        "32",
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

    const harness = new PiTuiHarness(options, paneId, socket);
    await harness.waitUntil(`Pi ${EXPECTED_VERSION} child version`, () => {
      if (!existsSync(versionPath)) return false;
      return readFileSync(versionPath, "utf8").trim() === EXPECTED_VERSION;
    });
    await harness.waitFor("[Extensions]", READY_TIMEOUT_MS);
    await harness.waitFor(
      /0\.0%\/|\$0\.000|gpt-|claude|gemini/i,
      READY_TIMEOUT_MS,
    );
    await harness.waitFor(/tmux extended-keys is\s+off/, READY_TIMEOUT_MS);

    const executable = readFileSync(executablePath, "utf8").trim();
    harness.assert(
      executable === piExecutable,
      `Child executable changed: expected ${piExecutable}, got ${executable}`,
    );
    return harness;
  }

  async capture(ansi = false): Promise<string> {
    return execute(
      [
        "tmux",
        "-S",
        this.#socket,
        "capture-pane",
        "-p",
        "-J",
        ...(ansi ? ["-e"] : []),
        "-t",
        this.paneId,
        "-S",
        "-",
      ],
      true,
    );
  }

  async sendLiteral(text: string): Promise<void> {
    await execute([
      "tmux",
      "-S",
      this.#socket,
      "send-keys",
      "-l",
      "-t",
      this.paneId,
      text,
    ]);
  }

  async sendKeys(...keys: string[]): Promise<void> {
    await execute([
      "tmux",
      "-S",
      this.#socket,
      "send-keys",
      "-t",
      this.paneId,
      ...keys,
    ]);
  }

  async submit(text: string): Promise<void> {
    if (text.startsWith("/")) {
      await this.sendLiteral("/");
      await this.waitFor(/→\s+settings(?:\s|$)/);
      await this.sendLiteral(text.slice(1));
    } else {
      await this.sendLiteral(text);
    }
    await Bun.sleep(POLL_MS);
    await this.sendKeys("Enter");
  }

  async submitCommand(command: string): Promise<void> {
    await this.sendLiteral("/");
    await this.waitFor(/→\s+settings(?:\s|$)/);
    await this.sendLiteral(command);
    const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await this.waitFor(new RegExp(`→\\s+${escaped}(?:\\s|$)`));
    await this.sendKeys("Enter");
  }

  async waitFor(expected: string | RegExp, timeoutMs = 8_000): Promise<string> {
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

  assert(condition: unknown, message: string): void {
    if (!condition) throw new Error(message);
  }

  async finish(): Promise<void> {
    await this.sendKeys("C-c").catch(() => undefined);
    await Bun.sleep(POLL_MS);
    await this.sendKeys("C-c").catch(() => undefined);
    await Bun.sleep(POLL_MS);
    await this.sendKeys("C-d").catch(() => undefined);
    await this.waitUntil(
      "Pi process exit",
      () => existsSync(this.#statusPath),
      4_000,
    ).catch(async () => {
      await execute(
        ["tmux", "-S", this.#socket, "kill-pane", "-t", this.paneId],
        true,
      );
      throw new Error(`Pi did not exit cleanly: ${this.options.name}`);
    });
    const status = Number.parseInt(readFileSync(this.#statusPath, "utf8"), 10);
    this.assert(
      status === 0,
      `Pi exited with status ${status}: ${this.options.name}`,
    );
    const log = existsSync(this.logPath)
      ? readFileSync(this.logPath, "utf8")
      : "";
    this.assert(log.length > 0, `No terminal log: ${this.options.name}`);
    this.assert(
      !/(?:Error loading extension|Extension error|Failed to load extension|exiting due to uncaughtException)/.test(
        log,
      ),
      `Extension error in ${this.options.name}:\n${log}`,
    );
  }

  async abort(): Promise<void> {
    await execute(["tmux", "-S", this.#socket, "kill-server"], true);
  }
}

export function makeRunDirectory(root: string): string {
  return Bun.spawnSync(["mktemp", "-d", "/tmp/pi-extension-baseline.XXXXXX"], {
    cwd: root,
  })
    .stdout.toString()
    .trim();
}

export async function cleanupRun(runDirectory: string): Promise<void> {
  for (const entry of readdirSync(runDirectory)) {
    if (!entry.endsWith(".tmux.sock")) continue;
    await execute(
      ["tmux", "-S", join(runDirectory, entry), "kill-server"],
      true,
    );
  }
  if (process.env.PI_E2E_KEEP !== "1")
    rmSync(runDirectory, { force: true, recursive: true });
}
