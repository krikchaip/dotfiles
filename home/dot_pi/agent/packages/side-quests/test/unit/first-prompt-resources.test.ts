import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, Skill } from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";

import { AgentDefinitions } from "../../agent-definitions.ts";
import type { ParentRuntime } from "../../parent/runtime.ts";
import { ParentTools } from "../../parent/tool.ts";

/**
 * Ordinary first prompts must not materialize child capability resources.
 */
test("first prompts do not discover, resolve, or copy unused child Packages", async () => {
  const root = mkdtempSync(join(tmpdir(), "sq-first-prompt-resources-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", root);
  try {
    const agents = join(root, "agents");
    const pkg = join(root, "installed", "node_modules", "sq-skill-fixture");
    mkdirSync(agents, { recursive: true });
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(agents, "specialist.md"),
      "---\ndescription: Specialist\nskills: true\nextensions: true\n---\n",
    );
    const filePath = join(pkg, "SKILL.md");
    writeFileSync(
      filePath,
      "---\nname: fixture\ndescription: Fixture\n---\nInstructions.\n",
    );
    const skill: Skill = {
      name: "fixture",
      description: "Fixture",
      filePath,
      baseDir: pkg,
      disableModelInvocation: false,
      sourceInfo: {
        path: filePath,
        source: "npm:sq-skill-fixture@1.0.0",
        origin: "package",
        scope: "user",
        baseDir: pkg,
      },
    };
    const discover = vi.fn(async () => [skill]);
    const resolve = vi.fn(async () => []);
    let beforeStart:
      | ((event: unknown, context: unknown) => unknown)
      | undefined;
    const pi = {
      on: (event: string, handler: typeof beforeStart) => {
        if (event === "before_agent_start") beforeStart = handler;
      },
      registerTool: vi.fn(),
      getActiveTools: () => ["read", "Agent"],
      getAllTools: () => [{ name: "read" }, { name: "Agent" }],
    } as unknown as ExtensionAPI;
    ParentTools.register(
      pi,
      {} as ParentRuntime,
      AgentDefinitions.resolve({ agentDirectory: root, cwd: root }),
      { parent: async () => [], resolve },
      discover,
    );
    await beforeStart?.(
      { systemPromptOptions: { skills: [skill] } },
      { cwd: root, ui: { notify: vi.fn() }, modelRegistry: { find: vi.fn() } },
    );
    expect.soft(discover).not.toHaveBeenCalled();
    expect.soft(resolve).not.toHaveBeenCalled();
    const directory = join(root, "side-quests", "resources");
    let entries: string[] = [];
    try {
      entries = readdirSync(directory);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
    expect(entries).toEqual([]);
  } finally {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});
