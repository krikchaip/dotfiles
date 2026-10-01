import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";

import {
  initializeChildExtension,
  takeChildExtensionTools,
} from "../../child/extension-host.ts";
import { RuntimeStore } from "../../store/runtime.ts";

const directories: string[] = [];
const originalRoot = process.env.PI_CODING_AGENT_DIR;
const identity = { parentId: "parent-id", childId: "child-id" };

afterEach(() => {
  takeChildExtensionTools(identity);
  vi.restoreAllMocks();
  if (originalRoot === undefined)
    Reflect.deleteProperty(process.env, "PI_CODING_AGENT_DIR");
  else process.env.PI_CODING_AGENT_DIR = originalRoot;
  for (const directory of directories.splice(0))
    rmSync(directory, { force: true, recursive: true });
});

/**
 * Creates one temporary extension source file.
 */
function extensionSource(source: string): { cwd: string; path: string } {
  const cwd = mkdtempSync(join(tmpdir(), "side-quests-child-extension-"));
  directories.push(cwd);
  process.env.PI_CODING_AGENT_DIR = cwd;
  const path = join(cwd, "extension.ts");
  writeFileSync(path, source);
  return { cwd, path };
}

/**
 * Creates the main child API surface used by the extension host.
 */
function childApi(): {
  handlers: Map<string, ((event: unknown) => void)[]>;
  pi: ExtensionAPI;
  tools: ToolDefinition[];
} {
  const handlers = new Map<string, ((event: unknown) => void)[]>();
  const tools: ToolDefinition[] = [];
  const pi = {
    appendEntry: vi.fn(),
    events: { emit: vi.fn(), on: vi.fn() },
    exec: vi.fn(),
    getActiveTools: vi.fn(() => []),
    getAllTools: vi.fn(() => []),
    getCommands: vi.fn(() => []),
    getFlag: vi.fn(),
    getSessionName: vi.fn(),
    getThinkingLevel: vi.fn(() => "off"),
    on(event: string, handler: (event: unknown) => void) {
      const registered = handlers.get(event) ?? [];
      registered.push(handler);
      handlers.set(event, registered);
    },
    registerCommand: vi.fn(),
    registerEntryRenderer: vi.fn(),
    registerFlag: vi.fn(),
    registerMarkdownTransformer: vi.fn(),
    registerMessageRenderer: vi.fn(),
    registerProvider: vi.fn(),
    registerShortcut: vi.fn(),
    registerTool(tool: ToolDefinition) {
      tools.push(tool);
    },
    sendMessage: vi.fn(),
    sendUserMessage: vi.fn(),
    setActiveTools: vi.fn(),
    setLabel: vi.fn(),
    setModel: vi.fn(),
    setSessionName: vi.fn(),
    setThinkingLevel: vi.fn(),
    unregisterProvider: vi.fn(),
  } as unknown as ExtensionAPI;
  return { handlers, pi, tools };
}

test("loads selected extensions once into the child registry", async () => {
  const loaded = join(tmpdir(), `side-quests-load-${process.pid}.txt`);
  rmSync(loaded, { force: true });
  const fixture = extensionSource(
    [
      'import { appendFileSync } from "node:fs";',
      "export default function (pi) {",
      `  appendFileSync(${JSON.stringify(loaded)}, "loaded\\n");`,
      "  pi.registerTool({",
      '    name: "child_only",',
      '    label: "Child only",',
      '    description: "Registered only in the child.",',
      '    parameters: { type: "object", properties: {} },',
      "    execute: async () => ({ content: [] }),",
      "  });",
      '  pi.on("session_start", () => {});',
      "}",
    ].join("\n"),
  );
  const api = childApi();

  await initializeChildExtension(api.pi, fixture.path, identity);

  expect(api.tools.map((tool) => tool.name)).toEqual(["child_only"]);
  expect(api.pi.getAllTools()).toEqual([]);
  expect(
    takeChildExtensionTools({ ...identity, childId: "other-child" }),
  ).toEqual([]);
  expect(takeChildExtensionTools(identity)).toEqual(["child_only"]);
  expect(takeChildExtensionTools(identity)).toEqual([]);
  expect(api.handlers.get("session_start")).toHaveLength(1);
  expect(readFileSync(loaded, "utf8")).toBe("loaded\n");
  rmSync(loaded, { force: true });
});

test("persists the original factory failure and stops the child before prompts", async () => {
  const fixture = extensionSource(
    'export default function () { throw new Error("fixture exploded"); }',
  );
  const api = childApi();

  const exit = vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("child exited");
  });

  await expect(
    initializeChildExtension(api.pi, fixture.path, identity),
  ).rejects.toThrow("child exited");
  expect(exit).toHaveBeenCalledWith(1);
  expect(
    RuntimeStore.readReadiness(identity.parentId, identity.childId),
  ).toEqual(
    expect.objectContaining({
      status: "failed",
      error: `${fixture.path}: Failed to load extension (factory): fixture exploded`,
    }),
  );
  expect(api.tools).toEqual([]);
  expect(api.handlers.size).toBe(0);
});
