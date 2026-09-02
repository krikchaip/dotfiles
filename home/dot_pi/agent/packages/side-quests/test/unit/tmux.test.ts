import { EventEmitter } from "node:events";
import { beforeEach, expect, test, vi } from "vitest";

const childProcess = vi.hoisted(() => ({ spawn: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: childProcess.spawn,
}));

import { Tmux } from "../../tmux.ts";

function processResult(
  status: number,
  stdout = "",
  stderr = "",
): ReturnType<typeof import("node:child_process").spawn> {
  const process = new EventEmitter() as ReturnType<
    typeof import("node:child_process").spawn
  >;
  const stdoutStream = new EventEmitter() as NonNullable<typeof process.stdout>;
  const stderrStream = new EventEmitter() as NonNullable<typeof process.stderr>;
  stdoutStream.setEncoding = vi.fn();
  stderrStream.setEncoding = vi.fn();
  process.stdout = stdoutStream;
  process.stderr = stderrStream;
  process.kill = vi.fn();

  queueMicrotask(() => {
    if (stdout) stdoutStream.emit("data", Buffer.from(stdout));
    if (stderr) stderrStream.emit("data", Buffer.from(stderr));
    process.emit("close", status);
  });

  return process;
}

function expectCleanupAfter(
  createStatus: number,
  createStdout: string,
): Promise<unknown> {
  childProcess.spawn.mockImplementationOnce(() =>
    processResult(createStatus, createStdout, "forced create failure"),
  );
  childProcess.spawn.mockImplementationOnce(() => processResult(0));

  return Tmux.createWindow({
    cwd: "/tmp",
    command: ["/usr/bin/true"],
    environment: {},
    parentPaneId: "",
  });
}

function expectCreationHookWasRemoved() {
  expect(childProcess.spawn).toHaveBeenCalledTimes(2);
  const createArgs = childProcess.spawn.mock.calls[0]?.[1] as string[];
  const cleanupArgs = childProcess.spawn.mock.calls[1]?.[1] as string[];
  expect(createArgs[0]).toBe("set-hook");
  expect(cleanupArgs).toEqual(["set-hook", "-u", createArgs[1]]);
}

beforeEach(() => {
  childProcess.spawn.mockReset();
});

test("failed shared-window creation removes its one-shot title hook", async () => {
  await expect(expectCleanupAfter(1, "")).rejects.toThrow(
    "Could not create Side Quests window",
  );
  expectCreationHookWasRemoved();
});

test("unidentified shared-window creation removes its one-shot title hook", async () => {
  await expect(expectCleanupAfter(0, "")).rejects.toThrow(
    "Could not identify Side Quests window",
  );
  expectCreationHookWasRemoved();
});

test("inserts a shared window directly after the parent window", async () => {
  childProcess.spawn.mockImplementationOnce(() => processResult(0, "%9\t@4\n"));
  childProcess.spawn.mockImplementationOnce(() =>
    processResult(0, "@5\t%10\n"),
  );

  await expect(
    Tmux.createWindow({
      cwd: "/tmp",
      command: ["/usr/bin/true"],
      environment: {},
      parentPaneId: "%9",
    }),
  ).resolves.toEqual({ windowId: "@5", paneId: "%10" });

  const createArgs = childProcess.spawn.mock.calls[1]?.[1] as string[];
  const newWindow = createArgs.indexOf("new-window");
  expect(createArgs.slice(newWindow + 1, newWindow + 4)).toEqual([
    "-a",
    "-t",
    "@4",
  ]);
});

test("uses normal placement when the parent pane is already missing", async () => {
  childProcess.spawn.mockImplementationOnce(() =>
    processResult(1, "", "can't find pane: %9"),
  );
  childProcess.spawn.mockImplementationOnce(() => processResult(0, "%8\n"));
  childProcess.spawn.mockImplementationOnce(() =>
    processResult(0, "@5\t%10\n"),
  );

  await Tmux.createWindow({
    cwd: "/tmp",
    command: ["/usr/bin/true"],
    environment: {},
    parentPaneId: "%9",
  });

  const createArgs = childProcess.spawn.mock.calls[2]?.[1] as string[];
  const newWindow = createArgs.indexOf("new-window");
  expect(createArgs.slice(newWindow + 1, newWindow + 4)).toEqual([
    "-d",
    "-P",
    "-F",
  ]);
});

test("uses normal placement when the parent disappears during creation", async () => {
  childProcess.spawn.mockImplementationOnce(() => processResult(0, "%9\t@4\n"));
  childProcess.spawn.mockImplementationOnce(() =>
    processResult(1, "", "can't find window: @4"),
  );
  childProcess.spawn.mockImplementationOnce(() => processResult(0));
  childProcess.spawn.mockImplementationOnce(() =>
    processResult(1, "", "can't find pane: %9"),
  );
  childProcess.spawn.mockImplementationOnce(() => processResult(0, "%8\n"));
  childProcess.spawn.mockImplementationOnce(() =>
    processResult(0, "@5\t%10\n"),
  );

  await Tmux.createWindow({
    cwd: "/tmp",
    command: ["/usr/bin/true"],
    environment: {},
    parentPaneId: "%9",
  });

  const fallbackArgs = childProcess.spawn.mock.calls[5]?.[1] as string[];
  const newWindow = fallbackArgs.indexOf("new-window");
  expect(fallbackArgs.slice(newWindow + 1, newWindow + 4)).toEqual([
    "-d",
    "-P",
    "-F",
  ]);
});

test("does not hide a parent-window inspection error", async () => {
  childProcess.spawn.mockImplementationOnce(() =>
    processResult(1, "", "forced inspection failure"),
  );
  childProcess.spawn.mockImplementationOnce(() => processResult(0, "%9\n"));

  await expect(
    Tmux.createWindow({
      cwd: "/tmp",
      command: ["/usr/bin/true"],
      environment: {},
      parentPaneId: "%9",
    }),
  ).rejects.toThrow(
    "Could not inspect parent tmux window: forced inspection failure",
  );
  expect(childProcess.spawn).toHaveBeenCalledTimes(2);
});

test("parents in one window each insert after their common parent", async () => {
  childProcess.spawn.mockImplementationOnce(() => processResult(0, "%1\t@0\n"));
  childProcess.spawn.mockImplementationOnce(() => processResult(0, "@1\t%3\n"));
  childProcess.spawn.mockImplementationOnce(() => processResult(0, "%2\t@0\n"));
  childProcess.spawn.mockImplementationOnce(() => processResult(0, "@2\t%4\n"));

  for (const parentPaneId of ["%1", "%2"]) {
    await Tmux.createWindow({
      cwd: "/tmp",
      command: ["/usr/bin/true"],
      environment: {},
      parentPaneId,
    });
  }

  for (const callIndex of [1, 3]) {
    const createArgs = childProcess.spawn.mock.calls[
      callIndex
    ]?.[1] as string[];
    const newWindow = createArgs.indexOf("new-window");
    expect(createArgs.slice(newWindow + 1, newWindow + 4)).toEqual([
      "-a",
      "-t",
      "@0",
    ]);
  }
});
