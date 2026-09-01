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
