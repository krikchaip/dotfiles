import { writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Captures one real-model Agent decision without launching the child. */
export default function captureAgentCall(pi: ExtensionAPI): void {
  pi.on("tool_call", (event) => {
    if (event.toolName !== "Agent") return;

    const outputPath = process.env.SIDE_QUESTS_AGENT_CALL_PATH;
    if (!outputPath)
      throw new Error("SIDE_QUESTS_AGENT_CALL_PATH is required.");

    writeFileSync(outputPath, `${JSON.stringify(event.input, null, 2)}\n`);

    return {
      block: true,
      reason: "Captured Agent arguments for the model behavior test.",
      terminate: true,
    };
  });
}
