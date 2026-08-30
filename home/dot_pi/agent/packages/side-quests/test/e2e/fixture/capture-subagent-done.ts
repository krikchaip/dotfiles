import { existsSync, writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { ChildRuntime } from "../../../child/runtime.ts";
import { ChildTools, SUBAGENT_DONE_TOOL_NAME } from "../../../child/tool.ts";

/** Captures one real-model completion decision with production tool guidance. */
export default function captureSubagentDone(pi: ExtensionAPI): void {
  const outputPath = process.env.SIDE_QUESTS_SUBAGENT_DONE_PATH;
  if (!outputPath)
    throw new Error("SIDE_QUESTS_SUBAGENT_DONE_PATH is required.");

  let assistantContent: unknown = [];
  const runtime = {
    askParent() {
      throw new Error("ask_parent is inactive in completion behavior tests.");
    },
    declareCompletion() {},
  } as unknown as ChildRuntime;

  ChildTools.register(pi, runtime);

  pi.on("session_start", () => {
    pi.setActiveTools([SUBAGENT_DONE_TOOL_NAME]);
  });

  pi.on("message_end", (event) => {
    if (event.message.role === "assistant" && "content" in event.message)
      assistantContent = event.message.content;
  });

  pi.on("tool_call", (event) => {
    if (event.toolName !== SUBAGENT_DONE_TOOL_NAME) return;

    writeDecision(outputPath, "tool", assistantContent, event.input);
  });

  pi.on("agent_settled", () => {
    if (!existsSync(outputPath))
      writeDecision(outputPath, "normal", assistantContent);
  });
}

function writeDecision(
  outputPath: string,
  outcome: "normal" | "tool",
  assistantContent: unknown,
  input?: unknown,
): void {
  writeFileSync(
    outputPath,
    `${JSON.stringify({ assistantContent, input, outcome }, null, 2)}\n`,
  );
}
