import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";

import { ChildCommands } from "../../child/command.ts";
import type { ChildRuntime } from "../../child/runtime.ts";

type Command = Parameters<ExtensionAPI["registerCommand"]>[1];
type Shortcut = Parameters<ExtensionAPI["registerShortcut"]>[1];

function registeredCommand(options: { readonly active?: boolean } = {}) {
  let command: Command | undefined;
  let shortcut: Shortcut | undefined;
  const focusParent = vi.fn();
  const startCompletionTurn = vi.fn(async () => undefined);
  const notify = vi.fn();
  const runtime = {
    focusParent,
    isActive: () => options.active ?? false,
    startCompletionTurn,
  } as unknown as ChildRuntime;
  const pi = {
    on() {},
    registerCommand(name: string, definition: Command) {
      if (name === "subagent-done") command = definition;
    },
    registerShortcut(key: string, definition: Shortcut) {
      if (key === "shift+up") shortcut = definition;
    },
  } as unknown as ExtensionAPI;

  ChildCommands.register(pi, runtime);
  expect(command).toBeDefined();
  expect(shortcut).toBeDefined();

  return {
    command: command as Command,
    context: { ui: { notify } },
    focusParent,
    notify,
    shortcut: shortcut as Shortcut,
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

test("Shift+Up returns focus to the parent pane", async () => {
  const fixture = registeredCommand();

  await fixture.shortcut.handler(fixture.context as never);

  expect(fixture.focusParent).toHaveBeenCalledOnce();
});

test("parent focus errors are visible", async () => {
  const fixture = registeredCommand();
  fixture.focusParent.mockImplementation(() => {
    throw new Error("Parent pane is gone.");
  });

  await fixture.shortcut.handler(fixture.context as never);

  expect(fixture.notify).toHaveBeenCalledWith("Parent pane is gone.", "error");
});
