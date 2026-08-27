import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentEndEvent,
  ExtensionAPI,
  ExtensionContext,
  MessageEndEvent,
} from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";

import { ChildRuntime } from "../../child/runtime.ts";
import { SessionStore } from "../../store/session.ts";

const originalEnvironment = {
  childId: process.env.PI_SIDE_QUESTS_CHILD_ID,
  parentId: process.env.PI_SIDE_QUESTS_PARENT_ID,
  root: process.env.PI_CODING_AGENT_DIR,
  session: process.env.PI_SIDE_QUESTS_SESSION,
};
const temporaryRoots: string[] = [];

afterEach(() => {
  process.env.PI_CODING_AGENT_DIR = originalEnvironment.root;
  process.env.PI_SIDE_QUESTS_CHILD_ID = originalEnvironment.childId;
  process.env.PI_SIDE_QUESTS_PARENT_ID = originalEnvironment.parentId;
  process.env.PI_SIDE_QUESTS_SESSION = originalEnvironment.session;

  for (const root of temporaryRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function autonomousRuntime() {
  const root = mkdtempSync(join(tmpdir(), "side-quests-child-runtime-"));
  temporaryRoots.push(root);
  process.env.PI_CODING_AGENT_DIR = root;

  const manifest = SessionStore.create({
    parentId: "parent-id",
    childId: "child-id",
    ownerId: "owner-id",
    cwd: root,
    description: "continue after a terminating tool",
    lifecycle: "autonomous",
    inheritContext: false,
    tools: ["read"],
  });
  process.env.PI_SIDE_QUESTS_CHILD_ID = manifest.childId;
  process.env.PI_SIDE_QUESTS_PARENT_ID = manifest.parentId;
  process.env.PI_SIDE_QUESTS_SESSION = manifest.sessionPath;

  const handlers = new Map<string, (...args: never[]) => unknown>();
  const sendMessage = vi.fn();
  const pi = {
    on(name: string, handler: (...args: never[]) => unknown) {
      handlers.set(name, handler);
    },
    sendMessage,
  } as unknown as ExtensionAPI;

  ChildRuntime.register(pi);

  return {
    emit(name: string, ...args: unknown[]) {
      return handlers.get(name)?.(...(args as never[]));
    },
    sendMessage,
  };
}

test("continues a settled autonomous tool run before shutdown", () => {
  const fixture = autonomousRuntime();
  const shutdown = vi.fn();
  const assistant = {
    role: "assistant",
    content: [{ type: "toolCall", id: "call-id", name: "read", arguments: {} }],
    stopReason: "toolUse",
  } as MessageEndEvent["message"];

  fixture.emit("agent_start");
  fixture.emit("message_end", {
    type: "message_end",
    message: assistant,
  } satisfies MessageEndEvent);
  fixture.emit("agent_end", {
    type: "agent_end",
    messages: [assistant],
  } as AgentEndEvent);

  expect(fixture.sendMessage).not.toHaveBeenCalled();

  fixture.emit("agent_settled", { type: "agent_settled" }, {
    shutdown,
    ui: { notify: vi.fn() },
  } as unknown as ExtensionContext);

  expect(shutdown).not.toHaveBeenCalled();
  expect(fixture.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({ customType: "side-quest-tool-continuation" }),
    { triggerTurn: true, deliverAs: "steer" },
  );
});
