import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";

import { ParentCommands } from "../../parent/command.ts";
import type { ParentChild, ParentRuntime } from "../../parent/runtime.ts";
import type { ParentUI } from "../../parent/ui.ts";

type Command = Parameters<ExtensionAPI["registerCommand"]>[1];
type NavigationEvent =
  | { readonly closeChildId: string }
  | { readonly focusChildId: string }
  | undefined;

function child(childId: string): ParentChild {
  return {
    manifest: {
      childId,
      description: `${childId} task`,
      displayName: childId,
    },
  } as ParentChild;
}

function fixture(options: {
  readonly children: ParentChild[];
  readonly events: readonly NavigationEvent[];
}) {
  let command: Command | undefined;
  let live = [...options.children];
  const close = vi.fn((childId: string) => {
    live = live.filter((candidate) => candidate.manifest.childId !== childId);
  });
  const focus = vi.fn();
  const selectLiveChild = vi.fn(
    async (
      _context: unknown,
      closeChild: (childId: string) => void,
      focusChild: (childId: string) => void,
    ): Promise<void> => {
      for (const event of options.events) {
        if (!event) return;

        if ("closeChildId" in event) closeChild(event.closeChildId);
        if ("focusChildId" in event) focusChild(event.focusChildId);
      }
    },
  );

  const runtime = {
    children: () => live,
    close,
    focus,
  } as unknown as ParentRuntime;
  const ui = { selectLiveChild } as unknown as ParentUI;
  const pi = {
    registerCommand(name: string, definition: Command) {
      if (name === "side-quests") command = definition;
    },
    registerShortcut() {},
  } as unknown as ExtensionAPI;

  ParentCommands.register(pi, runtime, ui);
  expect(command).toBeDefined();

  const confirm = vi.fn(async () => true);
  const context = {
    mode: "tui",
    ui: { confirm, notify: vi.fn() },
  };

  return {
    close,
    command: command as Command,
    confirm,
    context,
    focus,
    selectLiveChild,
  };
}

test("confirmed deletion stays inside one mounted navigation component", async () => {
  const scenario = fixture({
    children: [child("selected"), child("next")],
    events: [{ closeChildId: "selected" }, undefined],
  });

  await scenario.command.handler("", scenario.context as never);

  expect(scenario.close).toHaveBeenCalledWith("selected");
  expect(scenario.selectLiveChild).toHaveBeenCalledOnce();
  expect(scenario.confirm).not.toHaveBeenCalled();
});

test("confirmed deletion closes navigation after the final child", async () => {
  const scenario = fixture({
    children: [child("only")],
    events: [{ closeChildId: "only" }, undefined],
  });

  await scenario.command.handler("", scenario.context as never);

  expect(scenario.close).toHaveBeenCalledWith("only");
  expect(scenario.selectLiveChild).toHaveBeenCalledOnce();
});

test("opening a selected child focuses its pane without remounting", async () => {
  const scenario = fixture({
    children: [child("selected")],
    events: [{ focusChildId: "selected" }, undefined],
  });

  await scenario.command.handler("", scenario.context as never);

  expect(scenario.focus).toHaveBeenCalledWith("selected");
});
