import type {
  AgentToolResult,
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";

import { ParentRuntime } from "../../parent/runtime.ts";
import { ParentTools } from "../../parent/tool.ts";
import type { ChildManifest } from "../../store/session.ts";
import { SessionStore } from "../../store/session.ts";
import { Tmux } from "../../tmux.ts";

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

  ParentTools.register(pi, ParentRuntime.register(pi));
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

async function executeAgent(
  request: Record<string, unknown>,
  runtime: Pick<ParentRuntime, "continue" | "launch" | "ownerId">,
): Promise<AgentToolResult<unknown> | undefined> {
  const tools: ToolDefinition[] = [];
  const pi = {
    getActiveTools: () => ["read", "Agent"],
    registerTool: (tool: ToolDefinition) => tools.push(tool),
  } as unknown as ExtensionAPI;

  ParentTools.register(pi, runtime as ParentRuntime);

  return tools[0]?.execute("call-id", request, undefined, undefined, {
    cwd: "/tmp",
    model: undefined,
    sessionManager: {
      getSessionFile: () => "/tmp/parent/session.jsonl",
      getSessionId: () => "parent-id",
    },
    thinkingLevel: "off",
  } as never);
}

test("registers only the public Agent tool", () => {
  const tools = registerParentTools();

  expect(tools).toHaveLength(1);
  expect(tools[0]?.name).toBe("Agent");
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
        statuses,
      },
    });
  },
);

test("resume result exposes empty presentation statuses and preserves details", async () => {
  const child = manifest({ lifecycle: "interactive", inheritContext: true });
  vi.spyOn(Tmux, "requireTmux").mockImplementation(() => {});
  vi.spyOn(SessionStore, "readResumableManifest").mockReturnValue(child);
  vi.spyOn(SessionStore, "updateManifest").mockReturnValue(child);
  const runtime = {
    ownerId: "owner-id",
    continue: vi.fn().mockResolvedValue({
      continuationKind: "answer",
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
    continuationKind: "answer",
    sessionPath: child.sessionPath,
    sideQuestPresentation: {
      version: 1,
      surface: "agent",
      statuses: [],
    },
  });
});

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
