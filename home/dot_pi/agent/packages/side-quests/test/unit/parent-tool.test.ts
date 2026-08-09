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
    { type: string; enum?: string[]; minLength?: number }
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
  });
  expect(schema.properties.resume).toMatchObject({ type: "string" });
  expect(schema.properties.inherit_context).toMatchObject({ type: "boolean" });
  expect(schema.properties.interactive).toMatchObject({ type: "boolean" });
});
