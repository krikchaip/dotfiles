import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";

import { ParentRuntime } from "../../parent/runtime.ts";
import { ParentTools } from "../../parent/tool.ts";

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
      "For a new sub-agent, copy the parent conversation once at launch. Defaults to true. Set false for fresh or unbiased work such as an adversarial review. Omit on resume.",
  });
  expect(schema.properties.interactive).toMatchObject({
    type: "boolean",
    description:
      "Lifecycle only. On launch, true keeps the pane open after completion; omission uses autonomous lifecycle. Use only for a new launch; omit on resume.",
  });
});
