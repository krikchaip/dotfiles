import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";

import { ParentCommands } from "../../parent/command.ts";
import type { ParentChild, ParentRuntime } from "../../parent/runtime.ts";
import type { NavigationIntent, ParentUI } from "../../parent/ui.ts";

type Command = Parameters<ExtensionAPI["registerCommand"]>[1];

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
  readonly intents: readonly NavigationIntent[];
}) {
  let command: Command | undefined;
  let live = [...options.children];
  const close = vi.fn((childId: string) => {
    live = live.filter((candidate) => candidate.manifest.childId !== childId);
  });
  const focus = vi.fn();
  const selectLiveChild = vi.fn();
  for (const intent of options.intents)
    selectLiveChild.mockResolvedValueOnce(intent);

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

test("confirmed deletion keeps navigation on the nearest surviving child", async () => {
  const children = [child("first"), child("selected"), child("next")];
  const scenario = fixture({
    children,
    intents: [{ action: "close", childId: "selected" }, undefined],
  });

  await scenario.command.handler("", scenario.context as never);

  expect(scenario.close).toHaveBeenCalledWith("selected");
  expect(scenario.selectLiveChild).toHaveBeenNthCalledWith(
    1,
    scenario.context,
    undefined,
  );
  expect(scenario.selectLiveChild).toHaveBeenNthCalledWith(
    2,
    scenario.context,
    "next",
  );
});

test("confirmed deletion closes navigation after the final child", async () => {
  const scenario = fixture({
    children: [child("only")],
    intents: [{ action: "close", childId: "only" }],
  });

  await scenario.command.handler("", scenario.context as never);

  expect(scenario.close).toHaveBeenCalledWith("only");
  expect(scenario.selectLiveChild).toHaveBeenCalledOnce();
});
