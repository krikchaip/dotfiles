import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupRun } from "../e2e/harness.ts";

test("cleanup closes only its server without inspecting processes after all panes exit", async () => {
  const runDirectory = mkdtempSync(join(tmpdir(), "pi-harness-cleanup-test-"));
  const socket = join(runDirectory, "finished-pane.tmux.sock");
  writeFileSync(socket, "");
  let serverClosed = false;

  const kill = spyOn(process, "kill").mockImplementation(() => {
    throw new Error("Cleanup must not signal a process after all panes exit");
  });
  // Mock only the OS command boundary. Public cleanup runs unchanged, and no
  // real tmux, ps, lsof, or process signal can be launched.
  const spawn = spyOn(Bun, "spawn").mockImplementation((command) => {
    const args = "cmd" in command ? command.cmd : command;
    let status = 0;
    if (args.includes("list-panes")) {
      expect(args).toEqual([
        "tmux", "-S", socket, "list-panes", "-a", "-F", "#{pane_pid}",
      ]);
      // A server that already closed has no remaining pane and returns an
      // empty failure response. Cleanup must still tolerate this state.
      status = 1;
    } else if (args.includes("kill-server")) {
      expect(args).toEqual(["tmux", "-S", socket, "kill-server"]);
      serverClosed = true;
    } else {
      throw new Error(
        `Cleanup inspected processes after pane exit: ${args.join(" ")}`,
      );
    }
    return {
      stdout: new Response("").body,
      stderr: new Response("").body,
      exited: Promise.resolve(status),
      kill() {
        throw new Error("No mocked OS command may time out");
      },
    } as ReturnType<typeof Bun.spawn>;
  });

  try {
    await cleanupRun(runDirectory);
    expect(serverClosed).toBe(true);
    expect(kill).not.toHaveBeenCalled();
  } finally {
    spawn.mockRestore();
    kill.mockRestore();
    rmSync(runDirectory, { recursive: true, force: true });
  }
});

test("cleanup stops owned descendants before their pane and ignores invalid or unrelated PIDs", async () => {
  const runDirectory = mkdtempSync(join(tmpdir(), "pi-harness-cleanup-test-"));
  const ownedRoot = realpathSync(runDirectory);
  const socket = join(runDirectory, "active-pane.tmux.sock");
  writeFileSync(socket, "");
  const inspected: number[] = [];
  const events: Array<[number, string | number | undefined] | "server closed"> = [];

  const kill = spyOn(process, "kill").mockImplementation((pid, signal) => {
    events.push([pid, signal]);
    return true;
  });
  const spawn = spyOn(Bun, "spawn").mockImplementation((command) => {
    const args = "cmd" in command ? command.cmd : command;
    let stdout = "";
    if (args.includes("list-panes")) {
      expect(args).toEqual([
        "tmux", "-S", socket, "list-panes", "-a", "-F", "#{pane_pid}",
      ]);
      stdout = "0\n-7\n1.5\nNaN\nInfinity\n987654\n\n";
    } else if (args[0] === "ps") {
      expect(args).toEqual(["ps", "-axo", "pid=,ppid="]);
      stdout = "987654 1\n987655 987654\n987656 987654\n765432 1\n";
    } else if (args[0] === "lsof") {
      const pid = Number(args[args.indexOf("-p") + 1]);
      expect([987654, 987655, 987656]).toContain(pid);
      inspected.push(pid);
      const cwd = pid === 987654
        ? ownedRoot
        : pid === 987655
          ? join(ownedRoot, "child")
          : `${ownedRoot}-unrelated`;
      stdout = `n${cwd}\n`;
    } else if (args.includes("kill-server")) {
      expect(args).toEqual(["tmux", "-S", socket, "kill-server"]);
      events.push("server closed");
    } else {
      throw new Error(`Unexpected OS command: ${args.join(" ")}`);
    }
    return {
      stdout: new Response(stdout).body,
      stderr: new Response("").body,
      exited: Promise.resolve(0),
      kill() {
        throw new Error("No mocked OS command may time out");
      },
    } as ReturnType<typeof Bun.spawn>;
  });

  try {
    await cleanupRun(runDirectory);
    expect(inspected.toSorted()).toEqual([987654, 987655, 987656]);
    expect(events).toEqual([
      [987655, "SIGKILL"],
      [987654, "SIGKILL"],
      "server closed",
    ]);
  } finally {
    spawn.mockRestore();
    kill.mockRestore();
    rmSync(runDirectory, { recursive: true, force: true });
  }
});
