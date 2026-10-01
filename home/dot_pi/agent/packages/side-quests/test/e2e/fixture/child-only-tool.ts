import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/**
 * Provides a tool whose selected extension is absent from the parent registry.
 */
export default function registerChildOnlyTool(pi: ExtensionAPI): void {
  const root = process.env.PI_CODING_AGENT_DIR;
  if (!root) throw new Error("Missing Pi state directory.");
  appendFileSync(join(root, "child-only-tool-loads.txt"), "loaded\n");

  pi.registerTool({
    name: "child_search",
    label: "Child search",
    description: "Search through the selected child-only extension.",
    parameters: Type.Object({}),
    async execute() {
      appendFileSync(
        join(root, "child-only-tool-executions.txt"),
        "searched\n",
      );
      return {
        content: [{ type: "text", text: "Child search completed." }],
        details: {},
      };
    },
  });
}
