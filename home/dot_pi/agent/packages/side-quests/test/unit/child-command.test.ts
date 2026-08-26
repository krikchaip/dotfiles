import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";

import { ChildCommands } from "../../child/command.ts";
import type { ChildRuntime } from "../../child/runtime.ts";

type Command = Parameters<ExtensionAPI["registerCommand"]>[1];

function registeredCommand(options: { readonly active?: boolean } = {}) {
  let command: Command | undefined;
  const complete = vi.fn();
  const wrapUp = vi.fn(async () => undefined);
  const notify = vi.fn();
  const runtime = {
    complete,
    isActive: () => options.active ?? false,
    onInteractive: (listener: () => void) => listener(),
    wrapUp,
  } as unknown as ChildRuntime;
  const pi = {
    on() {},
    registerCommand(name: string, definition: Command) {
      if (name === "subagent-done") command = definition;
    },
  } as unknown as ExtensionAPI;

  ChildCommands.register(pi, runtime);
  expect(command).toBeDefined();

  return {
    command: command as Command,
    complete,
    context: { ui: { notify }, shutdown: vi.fn() },
    notify,
    wrapUp,
  };
}

test("plain completion closes with the latest settled response", async () => {
  const fixture = registeredCommand();

  await fixture.command.handler("", fixture.context as never);

  expect(fixture.complete).toHaveBeenCalledOnce();
  expect(fixture.wrapUp).not.toHaveBeenCalled();
});

test("--wrap-up starts final synthesis instead of immediate completion", async () => {
  const fixture = registeredCommand();

  await fixture.command.handler(" --wrap-up ", fixture.context as never);

  expect(fixture.wrapUp).toHaveBeenCalledOnce();
  expect(fixture.complete).not.toHaveBeenCalled();
});

test("completion rejects unknown arguments", async () => {
  const fixture = registeredCommand();

  await fixture.command.handler("later", fixture.context as never);

  expect(fixture.notify).toHaveBeenCalledWith(
    "Usage: /subagent-done [--wrap-up]",
    "warning",
  );
  expect(fixture.complete).not.toHaveBeenCalled();
  expect(fixture.wrapUp).not.toHaveBeenCalled();
});

test("completion exposes only --wrap-up argument completion", () => {
  const fixture = registeredCommand();

  expect(fixture.command.getArgumentCompletions?.("--w")).toEqual([
    expect.objectContaining({ value: "--wrap-up" }),
  ]);
  expect(fixture.command.getArgumentCompletions?.("--wrap-up")).toBeNull();
  expect(fixture.command.getArgumentCompletions?.("other")).toBeNull();
});
