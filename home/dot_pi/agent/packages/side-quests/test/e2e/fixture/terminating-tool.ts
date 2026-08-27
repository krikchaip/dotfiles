import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Registers a tool that intentionally settles Pi after its result. */
export default function installTerminatingTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "e2e_terminating_tool",
    label: "E2E terminating tool",
    description: "Returns one result and intentionally settles the agent run.",
    parameters: Type.Object({}),
    async execute() {
      return {
        content: [
          { type: "text" as const, text: "Terminating tool completed." },
        ],
        details: undefined,
        terminate: true,
      };
    },
  });
}
