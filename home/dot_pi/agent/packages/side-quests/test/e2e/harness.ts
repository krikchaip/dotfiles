import {
  type Dirent,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const READY_TIMEOUT_MS = 8_000;
const POLL_MS = 100;

function quote(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function filesBelow(root: string): string[] {
  let entries: Dirent<string>[];

  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }

  return entries.flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

async function execute(
  command: string[],
  allowFailure = false,
): Promise<string> {
  const process = Bun.spawn(command, { stderr: "pipe", stdout: "pipe" });
  const [status, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);

  if (status !== 0 && !allowFailure) {
    throw new Error(
      `Command failed (${status}): ${command.join(" ")}\n${stderr || stdout}`,
    );
  }

  return stdout;
}

/** Removes all resources owned by one complete E2E run. */
export async function cleanupHarnessRun(
  sockets: readonly string[],
  runDirectory: string,
  keepArtifacts: boolean,
): Promise<void> {
  await Promise.all(
    sockets.map(async (socket) => {
      await execute(["tmux", "-S", socket, "kill-server"], true);
      rmSync(socket, { force: true });
    }),
  );
  if (!keepArtifacts) rmSync(runDirectory, { force: true, recursive: true });
}

export interface HarnessOptions {
  readonly extension: string;
  readonly root: string;
  readonly runDirectory: string;
  readonly scenario: Scenario;
  readonly socket: string;
}

/** Owns one real Pi process and its isolated tmux PTY. */
export class E2EHarness {
  readonly logPath: string;
  readonly stateDirectory: string;
  readonly workDirectory: string;

  #aborted = false;
  #logDonePath: string;
  #paneId = "";
  #statusPath: string;

  private constructor(private readonly options: HarnessOptions) {
    const { name } = options.scenario;

    this.logPath = join(options.runDirectory, `${name}.ansi`);
    this.#logDonePath = join(options.runDirectory, `${name}.ansi.done`);
    this.stateDirectory = join(options.runDirectory, `${name}-state`);
    this.workDirectory = join(options.runDirectory, `${name}-cwd`);
    this.#statusPath = join(options.runDirectory, `${name}.status`);
  }

  static async start(options: HarnessOptions): Promise<E2EHarness> {
    const harness = new E2EHarness(options);
    await harness.#start();
    return harness;
  }

  get name(): string {
    return this.options.scenario.name;
  }

  get parentPane(): string {
    return this.#paneId;
  }

  async capture(paneId = this.#paneId): Promise<string> {
    return execute(
      [
        ...this.#tmuxCommand,
        "capture-pane",
        "-p",
        "-J",
        "-t",
        paneId,
        "-S",
        "-",
      ],
      true,
    );
  }

  filesNamed(name: string): string[] {
    return filesBelow(this.stateDirectory).filter(
      (path) => basename(path) === name,
    );
  }

  read(path: string): string {
    return readFileSync(path, "utf8");
  }

  storedTextContains(text: string): boolean {
    return this.filesNamed("session.jsonl").some((path) =>
      this.read(path).includes(text),
    );
  }

  async childPanes(): Promise<string[]> {
    const output = await this.tmux(
      "list-panes",
      "-a",
      "-F",
      "#{pane_id}\t#{@side_quests_child_id}",
    );

    return output
      .trim()
      .split("\n")
      .map((line) => line.split("\t"))
      .filter((fields) => fields.length === 2 && fields[1])
      .map(([pane]) => pane);
  }

  async childPane(timeoutMs = 15_000): Promise<string> {
    let pane = "";

    await this.waitUntil(
      "a managed child pane",
      async () => {
        pane = (await this.childPanes())[0] ?? "";
        return !!pane;
      },
      timeoutMs,
    );

    return pane;
  }

  async sendLiteral(
    paneId: string,
    text: string,
    enter = false,
  ): Promise<void> {
    await this.tmux("send-keys", "-l", "-t", paneId, text);
    if (enter) await this.sendKeys(paneId, "Enter");
  }

  async sendParent(text: string, enter = false): Promise<void> {
    await this.sendLiteral(this.#paneId, text, enter);
  }

  async sendKeys(paneId: string, ...keys: string[]): Promise<void> {
    await this.tmux("send-keys", "-t", paneId, ...keys);
  }

  async sendParentKeys(...keys: string[]): Promise<void> {
    await this.sendKeys(this.#paneId, ...keys);
  }

  async tmux(...arguments_: string[]): Promise<string> {
    return execute([...this.#tmuxCommand, ...arguments_]);
  }

  async waitFor(
    expected: string | RegExp,
    timeoutMs = 20_000,
    paneId = this.#paneId,
  ): Promise<string> {
    let view = "";

    await this.waitUntil(
      `terminal output ${String(expected)}`,
      async () => {
        view = await this.capture(paneId);
        return typeof expected === "string"
          ? view.includes(expected)
          : expected.test(view);
      },
      timeoutMs,
    );

    return view;
  }

  async waitForWithout(
    expected: string | RegExp,
    forbidden: string | RegExp,
    timeoutMs = 20_000,
    paneId = this.#paneId,
  ): Promise<string> {
    let view = "";

    await this.waitUntil(
      `terminal output ${String(expected)} without ${String(forbidden)}`,
      async () => {
        view = await this.capture(paneId);
        const containsForbidden =
          typeof forbidden === "string"
            ? view.includes(forbidden)
            : forbidden.test(view);

        if (containsForbidden)
          throw new Error(
            `Observed forbidden transient terminal output ${String(forbidden)}.\n\nPane:\n${view}`,
          );

        return typeof expected === "string"
          ? view.includes(expected)
          : expected.test(view);
      },
      timeoutMs,
    );

    return view;
  }

  async waitForStoredText(text: string, timeoutMs = 15_000): Promise<void> {
    await this.waitUntil(
      `stored session text ${JSON.stringify(text)}`,
      () => this.storedTextContains(text),
      timeoutMs,
    );
  }

  async waitUntil(
    description: string,
    predicate: () => boolean | Promise<boolean>,
    timeoutMs = 15_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (this.#aborted) throw new Error(`E2E scenario aborted: ${this.name}`);
      if (await predicate()) return;
      await Bun.sleep(POLL_MS);
    }

    const parent = await this.capture();

    throw new Error(
      `Timed out waiting for ${description}.\n\nParent pane:\n${parent}`,
    );
  }

  assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
  }

  async finish(): Promise<void> {
    if (this.options.scenario.process.managed)
      this.assert(
        this.filesNamed("session.jsonl").length > 0,
        `Managed child session was not retained: ${this.name}`,
      );

    await this.sendParentKeys("C-d").catch(() => undefined);
    await this.waitUntil(
      "the parent Pi process to exit",
      () => existsSync(this.#statusPath),
      3_000,
    ).catch(async () => {
      await execute(
        [...this.#tmuxCommand, "kill-pane", "-t", this.#paneId],
        true,
      );
      throw new Error(`Pi did not exit cleanly for ${this.name}`);
    });

    await this.waitUntil(
      "the terminal log pipe to flush",
      () => existsSync(this.#logDonePath),
      3_000,
    );

    const status = Number.parseInt(readFileSync(this.#statusPath, "utf8"), 10);
    this.assert(status === 0, `Pi exited with status ${status}: ${this.name}`);

    const log = existsSync(this.logPath) ? this.read(this.logPath) : "";
    this.assert(log.length > 0, `No terminal output captured: ${this.name}`);

    const tmuxWarning = "Side Quests: tmux is required; extension is inactive.";
    const warningCount = log.split(tmuxWarning).length - 1;

    this.assert(
      this.options.scenario.process.outsideTmux
        ? warningCount === 1
        : warningCount === 0,
      `Unexpected unsupported-tmux warning count for ${this.name}: ${warningCount}.`,
    );

    this.assert(
      !/(?:\(node:\d+\) Warning|Error loading extension|Extension error|Failed to load)/.test(
        log,
      ),
      `Startup errors found in ${this.name}:\n${log}`,
    );
  }

  async abort(): Promise<void> {
    this.#aborted = true;
    if (!this.#paneId) return;
    await execute(
      [...this.#tmuxCommand, "kill-pane", "-t", this.#paneId],
      true,
    );
  }

  get #tmuxCommand(): string[] {
    return ["tmux", "-S", this.options.socket];
  }

  async #start(): Promise<void> {
    const { process } = this.options.scenario;

    mkdirSync(this.workDirectory, { recursive: true });
    mkdirSync(this.stateDirectory, { recursive: true });

    if (process.settings)
      writeFileSync(
        join(this.stateDirectory, "settings.json"),
        JSON.stringify(process.settings),
      );

    if (process.managed) {
      const extensions = join(this.stateDirectory, "extensions");
      mkdirSync(extensions, { recursive: true });

      const providerPath = join(this.options.root, "test/e2e/provider.ts");
      writeFileSync(
        join(extensions, "e2e-provider.ts"),
        `export { default } from ${JSON.stringify(providerPath)};\n`,
      );

      for (const [index, fixture] of (
        process.extensionFixtures ?? []
      ).entries()) {
        const fixturePath = resolve(this.options.root, fixture);
        writeFileSync(
          join(extensions, `fixture-${index}.ts`),
          `export { default } from ${JSON.stringify(fixturePath)};\n`,
        );
      }
    }

    const command = ["pi"];
    if (!process.persistSession) command.push("--no-session");
    command.push(
      "--no-context-files",
      "--no-prompt-templates",
      "--no-themes",
      "--no-skills",
    );

    for (const extension of process.extensionsBefore ?? [])
      command.push("-e", resolve(this.options.root, extension));

    command.push("-e", this.options.extension);

    if (!process.managed) command.push("--no-extensions");
    else command.push("--model", "side-quests-e2e/fake");

    if (process.child)
      command.push(
        "-e",
        join(dirname(this.options.extension), "child", "index.ts"),
      );

    if (process.positionalPrompt) command.push(process.positionalPrompt);

    const environment: Record<string, string> = {
      COLORTERM: "truecolor",
      COLUMNS: String(this.options.scenario.width ?? 80),
      LINES: "30",
      PI_CODING_AGENT_DIR: this.stateDirectory,
      PI_TELEMETRY: "0",
      SIDE_QUESTS_E2E_SCENARIO: this.name,
      TERM: "xterm-256color",
    };

    if (process.tmuxFixture) {
      const realTmux = Bun.which("tmux");
      if (!realTmux) throw new Error("Could not locate tmux for E2E fixture.");

      const fixtureBin = join(this.stateDirectory, "fixture-bin");
      const fixtureTmux = join(fixtureBin, "tmux");
      mkdirSync(fixtureBin, { recursive: true });
      copyFileSync(
        resolve(this.options.root, process.tmuxFixture),
        fixtureTmux,
      );
      chmodSync(fixtureTmux, 0o700);
      environment.PATH = `${fixtureBin}:${Bun.env.PATH ?? ""}`;
      environment.SIDE_QUESTS_E2E_REAL_TMUX = realTmux;
    }

    if (!process.managed) environment.PI_OFFLINE = "1";
    if (process.child) environment.PI_SIDE_QUESTS_CHILD_ID = "e2e-child";
    if (process.lifecycle)
      environment.SIDE_QUESTS_E2E_LIFECYCLE = process.lifecycle;
    if (process.providerTokensPerSecond)
      environment.SIDE_QUESTS_E2E_TOKENS_PER_SECOND = String(
        process.providerTokensPerSecond,
      );

    const launchPath = join(
      this.options.runDirectory,
      `${this.name}-launch.sh`,
    );

    const gatePath = join(this.options.runDirectory, `${this.name}.gate`);
    const unsetTmux = process.outsideTmux ? " -u TMUX -u TMUX_PANE" : "";
    const assignments = Object.entries(environment)
      .map(([key, value]) => `${key}=${quote(value)}`)
      .join(" ");

    writeFileSync(
      launchPath,
      `#!/bin/sh\nset +e\nwhile [ ! -e ${quote(gatePath)} ]; do sleep 0.01; done\nenv${unsetTmux} ${assignments} ${command.map(quote).join(" ")}\nstatus=$?\nprintf '%s\\n' "$status" > ${quote(this.#statusPath)}\nexit "$status"\n`,
    );

    chmodSync(launchPath, 0o700);

    this.#paneId = (
      await execute([
        ...this.#tmuxCommand,
        "-f",
        "/dev/null",
        "new-session",
        "-d",
        "-P",
        "-F",
        "#{pane_id}",
        "-s",
        this.name,
        "-x",
        String(this.options.scenario.width ?? 80),
        "-y",
        "30",
        "-c",
        this.workDirectory,
        launchPath,
      ])
    ).trim();

    await this.tmux(
      "pipe-pane",
      "-O",
      "-t",
      this.#paneId,
      `cat > ${quote(this.logPath)}; : > ${quote(this.#logDonePath)}`,
    );

    writeFileSync(gatePath, "go\n");

    const ready = process.outsideTmux
      ? "Side Quests: tmux is required; extension is inactive."
      : "[Extensions]";

    await this.waitFor(ready, READY_TIMEOUT_MS);
  }
}
