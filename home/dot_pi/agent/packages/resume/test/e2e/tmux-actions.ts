import {
  chmodSync,
  existsSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  cleanupRun,
  makeRunDirectory,
  PiTuiHarness,
} from "../../../../extensions/test/e2e/harness.ts";
import { assert, writeSession } from "./support.ts";

const agentRoot = resolve(import.meta.dir, "../../../..");
const extensionPath = join(agentRoot, "packages/resume/index.ts");
const runDirectory = makeRunDirectory(agentRoot);

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

async function tmux(socket: string, ...args: string[]): Promise<string> {
  return execute(["tmux", "-S", socket, ...args]);
}

async function paneIds(socket: string): Promise<string[]> {
  return (await tmux(socket, "list-panes", "-a", "-F", "#{pane_id}"))
    .trim()
    .split("\n")
    .filter(Boolean);
}

async function splitScenario(
  target: "down" | "right" | "window",
): Promise<void> {
  const name = `resume-tmux-${target}`;
  const sessions = join(runDirectory, `${name}-sessions`);
  const current = join(sessions, "current.jsonl");
  const selected = join(sessions, "selected.jsonl");
  writeSession(
    current,
    `30000000-0000-7000-8000-00000000000${target.length}`,
    "Current Pane",
    ["CURRENT"],
    1,
  );
  writeSession(
    selected,
    `40000000-0000-7000-8000-00000000000${target.length}`,
    "Split Target",
    ["TARGET"],
    20,
  );
  const harness = await PiTuiHarness.start({
    name,
    root: agentRoot,
    runDirectory,
    persistSession: true,
    cliArguments: ["--session-dir", sessions, "--session", current],
    extensions: ["packages/resume"],
  });
  const socket = join(runDirectory, `${name}.tmux.sock`);
  try {
    let sourceWindow = "";
    let leftWindow = "";
    let rightWindow = "";
    if (target === "window") {
      sourceWindow = (
        await tmux(
          socket,
          "display-message",
          "-p",
          "-t",
          harness.paneId,
          "#{window_id}",
        )
      ).trim();
      leftWindow = (
        await tmux(
          socket,
          "new-window",
          "-b",
          "-d",
          "-P",
          "-F",
          "#{window_id}",
          "-t",
          sourceWindow,
          "sleep",
          "30",
        )
      ).trim();
      rightWindow = (
        await tmux(
          socket,
          "new-window",
          "-a",
          "-d",
          "-P",
          "-F",
          "#{window_id}",
          "-t",
          sourceWindow,
          "sleep",
          "30",
        )
      ).trim();
      const guardedOrder = (
        await tmux(socket, "list-windows", "-F", "#{window_id}")
      )
        .trim()
        .split("\n");
      const sourceIndex = guardedOrder.indexOf(sourceWindow);
      assert(
        guardedOrder[sourceIndex - 1] === leftWindow &&
          guardedOrder[sourceIndex + 1] === rightWindow,
        "Window fixture did not place guard windows on both sides of the active window",
      );
    }

    await harness.submitCommand("resume");
    await harness.waitFor("Current Pane");
    await harness.sendLiteral("Split Target");
    await harness.waitFor("Split Target");
    const beforePanes = await paneIds(socket);
    const beforeWindows = (
      await tmux(socket, "list-windows", "-F", "#{window_id}")
    )
      .trim()
      .split("\n").length;
    const sourceSize = (
      await tmux(
        socket,
        "display-message",
        "-p",
        "-t",
        harness.paneId,
        "#{pane_width} #{pane_height}",
      )
    )
      .trim()
      .split(" ")
      .map(Number);
    await harness.sendLiteral(
      target === "down" ? "\x1bs" : target === "right" ? "\x1bv" : "\x1bw",
    );
    await harness.waitUntil(
      `${target} tmux target`,
      async () => (await paneIds(socket)).length > beforePanes.length,
    );
    const afterPanes = await paneIds(socket);
    const child = afterPanes.find((pane) => !beforePanes.includes(pane));
    assert(child, `${target} did not create a child target`);
    const childCommand = await tmux(
      socket,
      "display-message",
      "-p",
      "-t",
      child,
      "#{pane_start_command}",
    );
    assert(
      childCommand.includes(selected),
      `${target} child did not open the selected session`,
    );
    assert(
      childCommand.includes("--session-dir"),
      `${target} child lost the custom session directory`,
    );
    const childCwd = (
      await tmux(
        socket,
        "display-message",
        "-p",
        "-t",
        child,
        "#{pane_current_path}",
      )
    ).trim();
    assert(
      childCwd === realpathSync(dirname(dirname(selected))),
      `${target} child used the wrong cwd: ${childCwd}`,
    );

    if (target === "window") {
      const afterWindowIds = (
        await tmux(socket, "list-windows", "-F", "#{window_id}")
      )
        .trim()
        .split("\n");
      assert(
        afterWindowIds.length === beforeWindows + 1,
        "Alt+W did not create exactly one window",
      );
      const childWindow = (
        await tmux(socket, "display-message", "-p", "-t", child, "#{window_id}")
      ).trim();
      const sourceIndex = afterWindowIds.indexOf(sourceWindow);
      assert(
        afterWindowIds[sourceIndex - 1] === leftWindow &&
          afterWindowIds[sourceIndex + 1] === childWindow &&
          afterWindowIds[sourceIndex + 2] === rightWindow,
        `Alt+W did not insert the new window directly after the active window: ${afterWindowIds.join(", ")}`,
      );
    } else {
      const childSize = (
        await tmux(
          socket,
          "display-message",
          "-p",
          "-t",
          child,
          "#{pane_width} #{pane_height}",
        )
      )
        .trim()
        .split(" ")
        .map(Number);
      assert(
        target === "down"
          ? childSize[0] === sourceSize[0]
          : childSize[1] === sourceSize[1],
        `${target} used the wrong split orientation`,
      );
    }
    await tmux(socket, "kill-pane", "-t", child).catch(() => undefined);
    await harness.finish();
  } finally {
    await harness.abort().catch(() => undefined);
  }
  console.log(
    target === "window"
      ? "PASS resume tmux window action uses exact adjacent placement between existing windows"
      : `PASS resume tmux ${target} action`,
  );
}

async function splitFailureScenario(): Promise<void> {
  const name = "resume-tmux-failure";
  const sessions = join(runDirectory, `${name}-sessions`);
  const current = join(sessions, "current.jsonl");
  const target = join(sessions, "target.jsonl");
  writeSession(
    current,
    "45000000-0000-7000-8000-000000000001",
    "Failure Current",
    ["CURRENT"],
    1,
  );
  writeSession(
    target,
    "45000000-0000-7000-8000-000000000002",
    "Failure Target",
    ["TARGET"],
    20,
  );
  const bin = join(runDirectory, `${name}-bin`);
  const shim = join(bin, "tmux");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    shim,
    '#!/bin/sh\nif [ "$1" = "split-window" ]; then echo "injected split failure" >&2; exit 23; fi\nexec /opt/homebrew/bin/tmux "$@"\n',
  );
  chmodSync(shim, 0o700);
  const harness = await PiTuiHarness.start({
    name,
    root: agentRoot,
    runDirectory,
    persistSession: true,
    cliArguments: ["--session-dir", sessions, "--session", current],
    extensions: ["packages/resume"],
    environment: { PATH: `${bin}:${process.env.PATH ?? ""}` },
  });
  const socket = join(runDirectory, `${name}.tmux.sock`);
  try {
    await harness.submitCommand("resume");
    await harness.waitFor("Failure Current");
    await harness.sendLiteral("Failure Target");
    await harness.waitFor("Failure Target");
    const before = await paneIds(socket);
    await harness.sendLiteral("\x1bs");
    await harness.waitFor("tmux open failed:");
    assert(
      (await paneIds(socket)).length === before.length,
      "Failed split left an extra pane",
    );
    assert(
      (await harness.capture()).includes("Ctrl+R expand"),
      "Failed split closed the resume selector",
    );
    await harness.sendKeys("Escape");
    await harness.waitUntil(
      "resume selector close after split failure",
      async () => {
        const view = await harness.capture();
        return (
          !view.includes("Resume Session (") && !view.includes("Ctrl+R expand")
        );
      },
    );
    await harness.finish();
  } finally {
    await harness.abort().catch(() => undefined);
  }
  console.log(
    "PASS resume tmux split failure stays in picker without an orphan pane",
  );
}

async function concurrentWriterScenario(): Promise<void> {
  const name = "resume-tmux-concurrent";
  const sessions = join(runDirectory, `${name}-sessions`);
  const current = join(sessions, "current.jsonl");
  const target = join(sessions, "target.jsonl");
  const targetLink = join(sessions, "target-link.jsonl");
  writeSession(
    current,
    "50000000-0000-7000-8000-000000000001",
    "Current Writer",
    ["CURRENT"],
    1,
  );
  writeSession(
    target,
    "50000000-0000-7000-8000-000000000002",
    "Concurrent Target",
    ["TARGET"],
    20,
  );
  symlinkSync(target, targetLink);
  const harness = await PiTuiHarness.start({
    name,
    root: agentRoot,
    runDirectory,
    persistSession: true,
    cliArguments: ["--session-dir", sessions, "--session", current],
    extensions: ["packages/resume"],
  });
  const socket = join(runDirectory, `${name}.tmux.sock`);
  const pi = Bun.which("pi");
  assert(pi, "Pi is not on PATH");
  let holder = "";
  let attached: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const holderHome = join(runDirectory, `${name}-holder-home`);
    const holderState = join(runDirectory, `${name}-holder-state`);
    const holderGate = join(runDirectory, `${name}-holder.gate`);
    const holderLaunch = join(runDirectory, `${name}-holder.sh`);
    const holderLog = join(runDirectory, `${name}-holder.ansi`);
    mkdirSync(holderHome, { recursive: true });
    mkdirSync(holderState, { recursive: true });
    writeFileSync(
      holderLaunch,
      [
        "#!/bin/sh",
        `while [ ! -e ${quote(holderGate)} ]; do sleep 0.01; done`,
        `env HOME=${quote(holderHome)} PI_CODING_AGENT_DIR=${quote(holderState)} PI_OFFLINE=1 PI_TELEMETRY=0 ${quote(pi)} --session-dir ${quote(sessions)} --session ${quote(target)} --no-context-files --no-prompt-templates --no-themes --no-skills --no-extensions -e ${quote(extensionPath)}`,
        "",
      ].join("\n"),
    );
    chmodSync(holderLaunch, 0o700);
    holder = (
      await tmux(
        socket,
        "split-window",
        "-d",
        "-P",
        "-F",
        "#{pane_id}",
        "-t",
        harness.paneId,
        "-c",
        dirname(dirname(target)),
        holderLaunch,
      )
    ).trim();
    await tmux(
      socket,
      "pipe-pane",
      "-O",
      "-t",
      holder,
      `cat > ${quote(holderLog)}`,
    );
    writeFileSync(holderGate, "go\n");
    await harness.waitUntil("holder session advertisement", async () => {
      const value = await execute(
        [
          "tmux",
          "-S",
          socket,
          "show-options",
          "-p",
          "-v",
          "-t",
          holder,
          "@pi_resume_session",
        ],
        true,
      );
      if (!(await paneIds(socket)).includes(holder)) {
        throw new Error(
          `Holder Pi exited before advertising:\n${await Bun.file(holderLog).text()}`,
        );
      }
      return value.includes(target);
    });
    const advertisement = JSON.parse(
      await tmux(
        socket,
        "show-options",
        "-p",
        "-v",
        "-t",
        holder,
        "@pi_resume_session",
      ),
    );
    await tmux(
      socket,
      "set-option",
      "-p",
      "-t",
      holder,
      "@pi_resume_session",
      JSON.stringify({ ...advertisement, path: targetLink }),
    );

    attached = Bun.spawn(["tmux", "-S", socket, "-C", "attach-session"], {
      stdin: "pipe",
      stdout: "ignore",
      stderr: "ignore",
    });
    await Bun.sleep(300);
    const attachedClients = await tmux(
      socket,
      "list-clients",
      "-F",
      "#{client_name}",
    );
    assert(
      attachedClients.trim().length > 0,
      "Control-mode tmux client did not attach",
    );

    await harness.submitCommand("resume");
    await harness.waitFor("Current Writer");
    await harness.sendLiteral("Concurrent Target");
    await harness.waitFor("Concurrent Target");
    const before = await paneIds(socket);
    await harness.sendKeys("Enter");
    await harness.waitFor("Session already open; press again to jump");
    assert(
      (await paneIds(socket)).length === before.length,
      "First Enter created a duplicate writer",
    );

    await harness.sendKeys("Down", "Up", "Enter");
    await harness.waitFor("Session already open; press again to jump");
    await Bun.sleep(1_650);
    await harness.sendKeys("Enter");
    await harness.waitFor("Session already open; press again to jump");
    await harness.sendKeys("Enter");
    await Bun.sleep(500);
    const jumpView = await harness.capture();
    const clients = await tmux(socket, "list-clients", "-F", "#{pane_id}");
    const jumpSucceeded =
      !jumpView.includes("Ctrl+R expand") &&
      clients.trim().split("\n").includes(holder);
    assert(
      (await paneIds(socket)).length === before.length,
      "Pane jump created a duplicate writer",
    );
    if (jumpView.includes("Ctrl+R expand")) {
      await harness.sendKeys("Escape");
      await harness.waitUntil(
        "resume selector close after failed pane jump",
        async () => !(await harness.capture()).includes("Ctrl+R expand"),
      );
    }

    await tmux(socket, "kill-pane", "-t", holder);
    holder = "";
    const malformed = (
      await tmux(
        socket,
        "new-window",
        "-d",
        "-P",
        "-F",
        "#{pane_id}",
        "-t",
        `${name}:`,
        "sleep",
        "30",
      )
    ).trim();
    await tmux(
      socket,
      "set-option",
      "-p",
      "-t",
      malformed,
      "@pi_resume_session",
      "not-json",
    );
    const stale = (
      await tmux(
        socket,
        "new-window",
        "-d",
        "-P",
        "-F",
        "#{pane_id}",
        "-t",
        `${name}:`,
        "sleep",
        "30",
      )
    ).trim();
    await tmux(
      socket,
      "set-option",
      "-p",
      "-t",
      stale,
      "@pi_resume_session",
      JSON.stringify({ pid: 2_147_483_647, path: target }),
    );

    await harness.submitCommand("resume");
    await harness.waitFor("Current Writer");
    await harness.sendLiteral("Concurrent Target");
    await harness.waitFor("Concurrent Target");
    const beforeOpen = await paneIds(socket);
    await harness.sendLiteral("\x1bs");
    await harness.waitUntil(
      "split ignoring malformed and stale advertisements",
      async () => (await paneIds(socket)).length > beforeOpen.length,
    );
    const opened = (await paneIds(socket)).find(
      (pane) => !beforeOpen.includes(pane),
    );
    assert(opened, "Malformed/stale advertisement blocked a valid split");
    await tmux(socket, "kill-pane", "-t", opened);
    await tmux(socket, "kill-pane", "-t", malformed).catch(() => undefined);
    await tmux(socket, "kill-pane", "-t", stale).catch(() => undefined);
    await harness.finish();
    assert(
      jumpSucceeded,
      `Second confirmation did not focus and close the existing holder pane; clients=${clients.trim()}`,
    );
  } finally {
    if (attached) {
      attached.kill();
      await attached.exited.catch(() => undefined);
    }
    if (holder && existsSync(target)) {
      await tmux(socket, "kill-pane", "-t", holder).catch(() => undefined);
    }
    await harness.abort().catch(() => undefined);
  }
  console.log(
    "PASS resume two-pane concurrent writer guard, expiry, reset, canonical path, and stale metadata",
  );
}

try {
  mkdirSync(runDirectory, { recursive: true });
  await Promise.all([
    splitScenario("down"),
    splitScenario("right"),
    splitScenario("window"),
    splitFailureScenario(),
    concurrentWriterScenario(),
  ]);
} finally {
  await cleanupRun(runDirectory);
}
