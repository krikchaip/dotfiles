import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";

import { ChildCommands } from "../../child/command.ts";
import type { ChildRuntime } from "../../child/runtime.ts";

type Command = Parameters<ExtensionAPI["registerCommand"]>[1];

function registeredCommand(options: { readonly active?: boolean } = {}) {
  let command: Command | undefined;
  const startCompletionTurn = vi.fn(async () => undefined);
  const notify = vi.fn();
  const runtime = {
    isActive: () => options.active ?? false,
    startCompletionTurn,
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
    context: { ui: { notify } },
    notify,
    startCompletionTurn,
  };
}

test("plain completion starts one hidden completion turn", async () => {
  const fixture = registeredCommand();

  await fixture.command.handler("", fixture.context as never);

  expect(fixture.startCompletionTurn).toHaveBeenCalledOnce();
});

test("completion rejects every argument", async () => {
  const fixture = registeredCommand();

  await fixture.command.handler("--wrap-up", fixture.context as never);

  expect(fixture.notify).toHaveBeenCalledWith(
    "Usage: /subagent-done",
    "warning",
  );
  expect(fixture.startCompletionTurn).not.toHaveBeenCalled();
});

test("completion refuses while an agent turn is active", async () => {
  const fixture = registeredCommand({ active: true });

  await fixture.command.handler("", fixture.context as never);

  expect(fixture.notify).toHaveBeenCalledWith(
    "Wait for the current turn or interrupt it first.",
    "warning",
  );
  expect(fixture.startCompletionTurn).not.toHaveBeenCalled();
});

test("completion has no argument suggestions", () => {
  const fixture = registeredCommand();

  expect(fixture.command.getArgumentCompletions).toBeUndefined();
});
