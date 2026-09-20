import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentToolResult,
  ExtensionAPI,
  Skill,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";

import { AgentDefinitions } from "../../agent-definitions.ts";
import { ParentRuntime } from "../../parent/runtime.ts";
import { ParentTools } from "../../parent/tool.ts";
import type { ChildManifest } from "../../store/session.ts";
import { SessionStore } from "../../store/session.ts";
import { Tmux } from "../../tmux.ts";

const EMPTY_DEFINITIONS = AgentDefinitions.resolve({
  agentDirectory: join(tmpdir(), "side-quests-no-agent-definitions"),
  cwd: join(tmpdir(), "side-quests-no-agent-definitions"),
});

type AgentRequestSchema = Readonly<{
  type: string;
  additionalProperties: boolean;
  required: string[];
  properties: Record<
    string,
    {
      type: string;
      description?: string;
      enum?: string[];
      minLength?: number;
    }
  >;
}>;

function registerParentTools(): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const pi = {
    registerTool(tool: ToolDefinition) {
      tools.push(tool);
    },
    on() {
      // Runtime shutdown registration is exercised by real Pi-in-tmux E2E.
    },
  } as unknown as ExtensionAPI;

  ParentTools.register(pi, ParentRuntime.register(pi), EMPTY_DEFINITIONS);
  return tools;
}

function manifest(overrides: Partial<ChildManifest> = {}): ChildManifest {
  return {
    version: 1,
    childId: "child-id",
    parentId: "parent-id",
    ownerId: "owner-id",
    sessionPath: "/tmp/side-quests/child-id/session.jsonl",
    cwd: "/tmp",
    agentName: "general-purpose",
    displayName: "general-purpose",
    description: "presentation contract",
    lifecycle: "autonomous",
    inheritContext: true,
    tools: ["read"],
    createdAt: 1,
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

function namedDefinitions(
  extraFrontmatter = "",
  tools = "[grep]",
): AgentDefinitions {
  const root = mkdtempSync(join(tmpdir(), "side-quests-parent-tool-"));
  const cwd = join(root, "project");
  const agentDirectory = join(root, "agent");
  const agents = join(cwd, ".pi", "agents");
  mkdirSync(agents, { recursive: true });
  writeFileSync(
    join(agents, "security.md"),
    [
      "---",
      "description: Review security and permission risks",
      "display_name: Security reviewer",
      `tools: ${tools}`,
      "inherit_context: false",
      "interactive: true",
      extraFrontmatter,
      "---",
      "Return evidence.",
    ].join("\n"),
  );

  try {
    return AgentDefinitions.resolve({ agentDirectory, cwd });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function malformedDefinitions(): AgentDefinitions {
  const root = mkdtempSync(join(tmpdir(), "side-quests-malformed-definition-"));
  const cwd = join(root, "project");
  const agents = join(cwd, ".pi", "agents");
  mkdirSync(agents, { recursive: true });
  writeFileSync(join(agents, "security.md"), "---\ndescription: 42\n---\n");

  try {
    return AgentDefinitions.resolve({
      agentDirectory: join(root, "agent"),
      cwd,
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

async function executeAgent(
  request: Record<string, unknown>,
  runtime: Pick<ParentRuntime, "continue" | "launch" | "ownerId"> &
    Partial<Pick<ParentRuntime, "assertRequiredTools">>,
  definitions = EMPTY_DEFINITIONS,
  notify = vi.fn(),
  cwd = "/tmp",
  modelExists = true,
  parentSkills: readonly Skill[] = [],
  registeredToolNames = ["read", "grep", "Agent"],
  parentPromptInputs: Record<string, unknown> = {},
): Promise<AgentToolResult<unknown> | undefined> {
  const tools: ToolDefinition[] = [];
  const pi = {
    getActiveTools: () => registeredToolNames,
    getAllTools: () => registeredToolNames.map((name) => ({ name })),
    on(event: string, handler: (event: unknown) => void) {
      if (event === "before_agent_start")
        handler({
          systemPromptOptions: { ...parentPromptInputs, skills: parentSkills },
        });
    },
    registerTool: (tool: ToolDefinition) => tools.push(tool),
  } as unknown as ExtensionAPI;

  ParentTools.register(
    pi,
    {
      assertRequiredTools() {},
      ...runtime,
    } as ParentRuntime,
    definitions,
  );

  return tools[0]?.execute("call-id", request, undefined, undefined, {
    cwd,
    getSystemPrompt: () => "",
    model: undefined,
    modelRegistry: { find: () => modelExists },
    sessionManager: {
      getSessionFile: () => "/tmp/parent/session.jsonl",
      getSessionId: () => "parent-id",
    },
    thinkingLevel: "off",
    ui: { notify },
  } as never);
}

test("registers only the public Agent tool", () => {
  const tools = registerParentTools();

  expect(tools).toHaveLength(1);
  expect(tools[0]?.name).toBe("Agent");
});

test("adds named definitions to the Agent enum and contiguous Guidelines catalog", () => {
  const tools: ToolDefinition[] = [];
  const pi = {
    registerTool(tool: ToolDefinition) {
      tools.push(tool);
    },
    on() {},
  } as unknown as ExtensionAPI;

  ParentTools.register(pi, ParentRuntime.register(pi), namedDefinitions());

  const tool = tools[0] as ToolDefinition;
  const schema = tool.parameters as unknown as AgentRequestSchema;
  expect(schema.properties.subagent_type?.enum).toEqual([
    "general-purpose",
    "security",
  ]);
  expect(tool.promptGuidelines?.slice(-2)).toEqual([
    "When a side quest matches a specialized sub-agent below, delegate that side quest directly to that sub-agent.",
    "Subagent security. Review security and permission risks",
  ]);
});

test("reports malformed agent definitions at parent startup", () => {
  let sessionStart:
    | ((
        event: unknown,
        context: { ui: { notify: ReturnType<typeof vi.fn> } },
      ) => void)
    | undefined;
  const pi = {
    on(event: string, listener: typeof sessionStart) {
      if (event === "session_start") sessionStart = listener;
    },
    registerTool() {},
  } as unknown as ExtensionAPI;
  const notify = vi.fn();

  ParentTools.register(pi, ParentRuntime.register(pi), malformedDefinitions());
  sessionStart?.({}, { ui: { notify } });

  expect(notify).toHaveBeenCalledWith(
    expect.stringContaining("ignored malformed agent definition"),
    "warning",
  );
});

test("tells the model that child configuration is launch-only", () => {
  const tool = registerParentTools()[0];

  expect(tool?.promptGuidelines).toContain(
    "On resume, omit subagent_type, inherit_context, and interactive. These fields configure only a new sub-agent and Agent.resume rejects them.",
  );
});

test("explains when interactive dialogue is useful", () => {
  const guidelines = registerParentTools()[0]?.promptGuidelines?.join("\n");

  expect(guidelines).toContain("Use interactive: true");
  expect(guidelines).toContain("decision grilling");
  expect(guidelines).toContain("requirements discovery");
  expect(guidelines).toContain("prototype feedback");
  expect(guidelines).toContain("human-in-the-loop review");
});

test("explains the omission-aware context inheritance policy", () => {
  const guidelines = registerParentTools()[0]?.promptGuidelines?.join("\n");

  expect(guidelines).toContain(
    "Omit inherit_context for standard context continuity; omission defaults to true.",
  );
  expect(guidelines).toContain(
    "Set inherit_context: false only for intentional context isolation",
  );
  expect(guidelines).toContain("independent verification");
  expect(guidelines).toContain("adversarial review");
  expect(guidelines).toContain("second opinion");
  expect(guidelines).toContain("competing design");
  expect(guidelines).toContain("removing conversation noise");
  expect(guidelines).toContain(
    "Set inherit_context: true only to override a named sub-agent that defaults to false.",
  );
});

test("new launch applies the selected named agent defaults", async () => {
  const child = manifest();
  vi.spyOn(Tmux, "requireTmux").mockImplementation(() => {});
  const create = vi.spyOn(SessionStore, "create").mockResolvedValue(child);
  const runtime = {
    ownerId: "owner-id",
    continue: vi.fn(),
    launch: vi.fn().mockResolvedValue(child),
  };

  await executeAgent(
    {
      description: "audit permissions",
      prompt: "Review the permission implementation.",
      subagent_type: "security",
    },
    runtime as never,
    namedDefinitions(),
  );

  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      agentName: "security",
      displayName: "Security reviewer",
      inheritContext: false,
      lifecycle: "interactive",
      tools: ["grep"],
    }),
  );
});

test("rejects an unknown configured model before creating a child session", async () => {
  vi.spyOn(Tmux, "requireTmux").mockImplementation(() => {});
  const create = vi.spyOn(SessionStore, "create");
  const runtime = {
    ownerId: "owner-id",
    continue: vi.fn(),
    launch: vi.fn(),
  };

  await expect(
    executeAgent(
      {
        description: "audit permissions",
        prompt: "Review the permission implementation.",
        subagent_type: "security",
      },
      runtime as never,
      namedDefinitions("model: test-provider/missing-model"),
      vi.fn(),
      "/tmp",
      false,
    ),
  ).rejects.toThrow(
    "Agent.subagent_type security has an unknown model: test-provider/missing-model",
  );
  expect(create).not.toHaveBeenCalled();
});

test("accepts denied child controls and force-enables them outside normal policy", async () => {
  const child = manifest();
  vi.spyOn(Tmux, "requireTmux").mockImplementation(() => {});
  const create = vi.spyOn(SessionStore, "create").mockResolvedValue(child);
  const runtime = {
    ownerId: "owner-id",
    continue: vi.fn(),
    launch: vi.fn().mockResolvedValue(child),
  };

  await executeAgent(
    {
      description: "audit permissions",
      prompt: "Review the permission implementation.",
      subagent_type: "security",
    },
    runtime as never,
    namedDefinitions("disallowed_tools: [ask_parent, subagent_done]"),
  );

  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ tools: ["grep"] }),
  );
});

test("hard-denies every known spawning tool for an all-tools policy", async () => {
  const child = manifest();
  vi.spyOn(Tmux, "requireTmux").mockImplementation(() => {});
  const create = vi.spyOn(SessionStore, "create").mockResolvedValue(child);
  const runtime = {
    ownerId: "owner-id",
    continue: vi.fn(),
    launch: vi.fn().mockResolvedValue(child),
  };

  await executeAgent(
    {
      description: "audit permissions",
      prompt: "Review the permission implementation.",
      subagent_type: "security",
    },
    runtime as never,
    namedDefinitions("", "all"),
    vi.fn(),
    "/tmp",
    true,
    [],
    ["read", "grep", "Agent", "Task", "delegate", "spawn_agent", "subagent"],
  );

  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ tools: ["read", "grep"] }),
  );
});

test.each([
  ["none", "", []],
  ["[read, grep]", "disallowed_tools: [grep]", ["read"]],
] as const)(
  "resolves normal tool policy tools: %s with %s",
  async (tools, extra, expectedTools) => {
    const child = manifest();
    vi.spyOn(Tmux, "requireTmux").mockImplementation(() => {});
    const create = vi.spyOn(SessionStore, "create").mockResolvedValue(child);
    const runtime = {
      ownerId: "owner-id",
      continue: vi.fn(),
      launch: vi.fn().mockResolvedValue(child),
    };

    await executeAgent(
      {
        description: "audit permissions",
        prompt: "Review the permission implementation.",
        subagent_type: "security",
      },
      runtime as never,
      namedDefinitions(extra, tools),
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ tools: expectedTools }),
    );
  },
);

test.each([
  ["[missing]", ""],
  ["[read]", "disallowed_tools: [missing]"],
] as const)(
  "rejects unknown configured tool policy: %s %s",
  async (tools, extra) => {
    vi.spyOn(Tmux, "requireTmux").mockImplementation(() => {});
    const runtime = { ownerId: "owner-id", continue: vi.fn(), launch: vi.fn() };

    await expect(
      executeAgent(
        {
          description: "audit permissions",
          prompt: "Review the permission implementation.",
          subagent_type: "security",
        },
        runtime as never,
        namedDefinitions(extra, tools),
      ),
    ).rejects.toThrow("Unknown child tool: missing");
  },
);

test("rejects an unavailable selected skill before creating a child session", async () => {
  vi.spyOn(Tmux, "requireTmux").mockImplementation(() => {});
  const create = vi.spyOn(SessionStore, "create");
  const runtime = {
    ownerId: "owner-id",
    continue: vi.fn(),
    launch: vi.fn(),
  };

  await expect(
    executeAgent(
      {
        description: "audit permissions",
        prompt: "Review the permission implementation.",
        subagent_type: "security",
      },
      runtime as never,
      namedDefinitions("available_skills: [not-a-real-skill]"),
    ),
  ).rejects.toThrow("Unknown child skill: not-a-real-skill");
  expect(create).not.toHaveBeenCalled();
});

test("omits the lazy skill catalog when the selected tool policy lacks read", async () => {
  const root = mkdtempSync(join(tmpdir(), "side-quests-skill-policy-"));
  const cwd = join(root, "project");
  const agentDirectory = join(root, "agent");
  const definitionsPath = join(cwd, ".pi", "agents");
  const skillPath = join(agentDirectory, "skills", "research");
  const lazySkillPath = join(agentDirectory, "skills", "tdd");
  const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
  mkdirSync(definitionsPath, { recursive: true });
  mkdirSync(skillPath, { recursive: true });
  mkdirSync(lazySkillPath, { recursive: true });
  writeFileSync(
    join(definitionsPath, "security.md"),
    "---\ndescription: Review security\ntools: [grep]\navailable_skills: [research, tdd]\npreload_skills: [research]\n---\n",
  );
  writeFileSync(
    join(skillPath, "SKILL.md"),
    "---\nname: research\ndescription: Test research skill\n---\n# Research\n",
  );
  writeFileSync(
    join(lazySkillPath, "SKILL.md"),
    "---\nname: tdd\ndescription: Test-driven development\n---\n# TDD\n",
  );
  process.env.PI_CODING_AGENT_DIR = agentDirectory;

  try {
    const child = manifest();
    vi.spyOn(Tmux, "requireTmux").mockImplementation(() => {});
    const create = vi.spyOn(SessionStore, "create").mockResolvedValue(child);
    const notify = vi.fn();
    const runtime = {
      ownerId: "owner-id",
      continue: vi.fn(),
      launch: vi.fn().mockResolvedValue(child),
    };

    await executeAgent(
      {
        description: "audit permissions",
        prompt: "Review the permission implementation.",
        subagent_type: "security",
      },
      runtime as never,
      AgentDefinitions.resolve({ agentDirectory, cwd }),
      notify,
      cwd,
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        noSkills: true,
        skillPaths: [],
        appendSystemPrompt: expect.stringContaining(
          `<skill name="research" location="${join(skillPath, "SKILL.md")}">`,
        ),
      }),
    );
    expect(notify).toHaveBeenCalledWith(
      "Side Quests omitted the child skill catalog because its tool policy lacks read.",
      "warning",
    );
  } finally {
    process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
    rmSync(root, { force: true, recursive: true });
  }
});

test("freezes the inherited parent skill catalog when agent skill fields are omitted", async () => {
  const root = mkdtempSync(
    join(tmpdir(), "side-quests-inherited-default-skills-"),
  );
  const cwd = join(root, "project");
  const agentDirectory = join(root, "agent");
  const skills = join(agentDirectory, "skills");
  const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
  mkdirSync(skills, { recursive: true });
  for (const name of ["research", "tdd"]) {
    const directory = join(skills, name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${name}\n---\n# ${name}\n`,
    );
  }
  process.env.PI_CODING_AGENT_DIR = agentDirectory;

  try {
    const child = manifest();
    vi.spyOn(Tmux, "requireTmux").mockImplementation(() => {});
    const create = vi.spyOn(SessionStore, "create").mockResolvedValue(child);
    const runtime = {
      ownerId: "owner-id",
      continue: vi.fn(),
      launch: vi.fn().mockResolvedValue(child),
    };

    await executeAgent(
      {
        description: "inherit skills",
        prompt: "Preserve only the parent's lazy skill catalog.",
      },
      runtime as never,
      EMPTY_DEFINITIONS,
      vi.fn(),
      cwd,
      true,
      [{ name: "tdd", disableModelInvocation: false }] as unknown as Skill[],
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        noSkills: true,
        skillPaths: [join(skills, "tdd", "SKILL.md")],
      }),
    );
  } finally {
    process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
    rmSync(root, { force: true, recursive: true });
  }
});

test("snapshots parent native prompt inputs and one-off extensions", async () => {
  const root = mkdtempSync(join(tmpdir(), "side-quests-parent-baseline-"));
  const cwd = join(root, "project");
  const extensionPath = join(cwd, "one-off.ts");
  const originalArgv = [...process.argv];
  mkdirSync(cwd, { recursive: true });
  writeFileSync(extensionPath, "export default () => {};\n");
  process.argv.splice(
    0,
    process.argv.length,
    "bun",
    "pi",
    "--extension",
    "./one-off.ts",
  );

  try {
    const child = manifest();
    vi.spyOn(Tmux, "requireTmux").mockImplementation(() => {});
    const create = vi.spyOn(SessionStore, "create").mockResolvedValue(child);
    const runtime = {
      ownerId: "owner-id",
      continue: vi.fn(),
      launch: vi.fn().mockResolvedValue(child),
    };

    await executeAgent(
      {
        description: "freeze parent baseline",
        prompt: "Preserve the parent native prompt inputs.",
      },
      runtime as never,
      EMPTY_DEFINITIONS,
      vi.fn(),
      cwd,
      true,
      [],
      ["read", "Agent"],
      {
        appendSystemPrompt: "PARENT APPEND",
        contextFiles: [{ content: "PARENT CONTEXT", path: "/tmp/AGENTS.md" }],
        customPrompt: "PARENT CUSTOM",
      },
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        extensionPaths: [extensionPath],
        parentSystemPromptInputs: {
          appendSystemPrompt: "PARENT APPEND",
          contextFiles: [{ content: "PARENT CONTEXT", path: "/tmp/AGENTS.md" }],
          customPrompt: "PARENT CUSTOM",
        },
      }),
    );
  } finally {
    process.argv.splice(0, process.argv.length, ...originalArgv);
    rmSync(root, { force: true, recursive: true });
  }
});

test("freezes only the parent lazy catalog when preloads require omitted-skill materialization", async () => {
  const root = mkdtempSync(join(tmpdir(), "side-quests-inherited-skills-"));
  const cwd = join(root, "project");
  const agentDirectory = join(root, "agent");
  const agents = join(cwd, ".pi", "agents");
  const skills = join(agentDirectory, "skills");
  const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
  mkdirSync(agents, { recursive: true });
  for (const name of ["research", "tdd", "extra"]) {
    const directory = join(skills, name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${name}\n---\n# ${name}\n`,
    );
  }
  writeFileSync(
    join(agents, "security.md"),
    "---\ndescription: Review security\ntools: [read]\npreload_skills: [research]\n---\n",
  );
  process.env.PI_CODING_AGENT_DIR = agentDirectory;

  try {
    const child = manifest();
    vi.spyOn(Tmux, "requireTmux").mockImplementation(() => {});
    const create = vi.spyOn(SessionStore, "create").mockResolvedValue(child);
    const runtime = {
      ownerId: "owner-id",
      continue: vi.fn(),
      launch: vi.fn().mockResolvedValue(child),
    };
    const parentSkills = [
      { name: "tdd", disableModelInvocation: false },
    ] as unknown as Skill[];

    await executeAgent(
      {
        description: "audit permissions",
        prompt: "Review the permission implementation.",
        subagent_type: "security",
      },
      runtime as never,
      AgentDefinitions.resolve({ agentDirectory, cwd }),
      vi.fn(),
      cwd,
      true,
      parentSkills,
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        noSkills: true,
        skillPaths: [join(skills, "tdd", "SKILL.md")],
      }),
    );
  } finally {
    process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
    rmSync(root, { force: true, recursive: true });
  }
});

test.each([
  [false, "autonomous", []],
  [true, "autonomous", ["inherited"]],
  [false, "interactive", ["interactive"]],
  [true, "interactive", ["inherited", "interactive"]],
] as const)(
  "launch result exposes the versioned presentation contract for inherit=%s lifecycle=%s",
  async (inheritContext, lifecycle, statuses) => {
    const child = manifest({ inheritContext, lifecycle });
    vi.spyOn(Tmux, "requireTmux").mockImplementation(() => {});
    vi.spyOn(SessionStore, "create").mockResolvedValue(child);
    const runtime = {
      ownerId: "owner-id",
      continue: vi.fn(),
      launch: vi.fn().mockResolvedValue(child),
    };

    const result = await executeAgent(
      {
        description: "presentation contract",
        inherit_context: inheritContext,
        interactive: lifecycle === "interactive",
        prompt: "Verify the result metadata.",
      },
      runtime as never,
    );

    expect(result?.details).toEqual({
      operation: "launched",
      continuationKind: undefined,
      sessionPath: child.sessionPath,
      sideQuestPresentation: {
        version: 1,
        surface: "agent",
        resultStatus: "spawned",
        statuses,
      },
    });
  },
);

test("rejects resume before mutating its manifest when a required tool is absent", async () => {
  const child = manifest();
  const assertRequiredTools = vi.fn(() => {
    throw new Error("Required child tool is unavailable: read");
  });
  vi.spyOn(Tmux, "requireTmux").mockImplementation(() => {});
  vi.spyOn(SessionStore, "readResumableManifest").mockReturnValue(child);
  const updateManifest = vi.spyOn(SessionStore, "updateManifest");
  const runtime = {
    ownerId: "owner-id",
    assertRequiredTools,
    continue: vi.fn(),
    launch: vi.fn(),
  };

  await expect(
    executeAgent(
      {
        description: "resume restricted reviewer",
        prompt: "Continue without a required tool.",
        resume: child.sessionPath,
      },
      runtime as never,
    ),
  ).rejects.toThrow("Required child tool is unavailable: read");

  expect(assertRequiredTools).toHaveBeenCalledWith(child);
  expect(updateManifest).not.toHaveBeenCalled();
  expect(runtime.continue).not.toHaveBeenCalled();
});

test.each([
  ["answer", "answered"],
  ["steer", "steered"],
] as const)(
  "resume %s result exposes %s presentation status and preserves details",
  async (continuationKind, resultStatus) => {
    const child = manifest({ lifecycle: "interactive", inheritContext: true });
    vi.spyOn(Tmux, "requireTmux").mockImplementation(() => {});
    vi.spyOn(SessionStore, "readResumableManifest").mockReturnValue(child);
    vi.spyOn(SessionStore, "updateManifest").mockReturnValue(child);
    const runtime = {
      ownerId: "owner-id",
      continue: vi.fn().mockResolvedValue({
        continuationKind,
        operation: "continued",
      }),
      launch: vi.fn(),
    };

    const result = await executeAgent(
      {
        description: "continue contract",
        prompt: "Continue.",
        resume: child.sessionPath,
      },
      runtime as never,
    );

    expect(result?.details).toEqual({
      operation: "continued",
      continuationKind,
      sessionPath: child.sessionPath,
      sideQuestPresentation: {
        version: 1,
        surface: "agent",
        resultStatus,
        statuses: [],
      },
    });
  },
);

test("defines the strict Agent request contract", () => {
  const schema = registerParentTools()[0]
    ?.parameters as unknown as AgentRequestSchema;

  expect(schema).toMatchObject({
    type: "object",
    additionalProperties: false,
    required: ["prompt", "description"],
  });
  expect(Object.keys(schema.properties).sort()).toEqual([
    "description",
    "inherit_context",
    "interactive",
    "prompt",
    "resume",
    "subagent_type",
  ]);
  expect(schema.properties.prompt).toMatchObject({
    type: "string",
    minLength: 1,
  });
  expect(schema.properties.description).toMatchObject({
    type: "string",
    minLength: 1,
  });
  expect(schema.properties.subagent_type).toMatchObject({
    type: "string",
    enum: ["general-purpose"],
    description:
      "Sub-agent role for a new side quest. Omit to use general-purpose. Use only for a new launch; omit on resume.",
  });
  expect(schema.properties.resume).toMatchObject({ type: "string" });
  expect(schema.properties.inherit_context).toMatchObject({
    type: "boolean",
    description:
      "New launch only. Omit for standard context continuity; omission defaults to true. Set false only for intentional context isolation, such as independent verification, an adversarial review, a second opinion, a competing design, or removing conversation noise. Set true only to override a named sub-agent that defaults to false. Omit on resume.",
  });
  expect(schema.properties.interactive).toMatchObject({
    type: "boolean",
    description:
      "Lifecycle only. On launch, true keeps the pane open after completion; omission uses autonomous lifecycle. Use only for a new launch; omit on resume.",
  });
});
