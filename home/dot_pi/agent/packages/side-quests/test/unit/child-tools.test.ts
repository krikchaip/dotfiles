import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";

import type { ChildRuntime } from "../../child/runtime.ts";
import { ChildTools } from "../../child/tool.ts";

type Tool = Parameters<ExtensionAPI["registerTool"]>[0];

function registeredTools() {
  const tools = new Map<string, Tool>();
  const askParent = vi.fn();
  const declareCompletion = vi.fn();
  const runtime = {
    askParent,
    declareCompletion,
  } as unknown as ChildRuntime;
  const pi = {
    registerTool(tool: Tool) {
      tools.set(tool.name, tool);
    },
  } as unknown as ExtensionAPI;

  ChildTools.register(pi, runtime);

  return { askParent, declareCompletion, tools };
}

test("registers subagent_done with one required result argument", () => {
  const fixture = registeredTools();
  const tool = fixture.tools.get("subagent_done");

  expect(tool).toBeDefined();
  expect(tool?.parameters).toMatchObject({
    additionalProperties: false,
    required: ["result"],
    properties: { result: { type: "string", minLength: 1 } },
  });
  expect(
    Object.keys((tool?.parameters as { properties: object }).properties),
  ).toEqual(["result"]);
});

test("gives subagent_done a mandatory explicit-completion prompt contract", () => {
  const tool = registeredTools().tools.get("subagent_done");

  expect(tool?.description).toContain(
    "final action MUST be exactly one `subagent_done` call",
  );
  expect(tool?.description).toContain(
    "Emit no normal assistant text before or after that call",
  );
  expect(tool?.promptSnippet).toContain(
    "Finish an autonomous side quest with one parent-facing subagent_done result",
  );
  expect(tool?.promptGuidelines).toEqual([
    "Autonomous sub-agents MUST use exactly one subagent_done({ result }) tool call as the final action after all assigned work and validation are complete.",
    "Never finish an autonomous side quest with a normal assistant response. Emit no assistant text before or after the final subagent_done call.",
    "Call subagent_done alone; do not combine it with any other tool call.",
    "Put the entire parent-facing handoff only in subagent_done.result, including the outcome, key evidence, blockers, and remaining uncertainty.",
  ]);
});

test("subagent_done declares the exact handoff and terminates the tool batch", async () => {
  const fixture = registeredTools();
  const tool = fixture.tools.get("subagent_done");

  const result = await tool?.execute(
    "call-id",
    { result: "  Verified final handoff.  " },
    undefined,
    undefined,
    {} as never,
  );

  expect(fixture.declareCompletion).toHaveBeenCalledWith(
    "  Verified final handoff.  ",
  );
  expect(result).toMatchObject({
    details: { result: "Verified final handoff." },
    terminate: true,
  });
});
