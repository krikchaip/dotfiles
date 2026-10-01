import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** Registers a parent tool whose providing extension can be excluded from a child. */
export default function registerParentOwnedTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "parent_owned_search",
    label: "Parent-owned search",
    description: "Search through the parent-only extension.",
    parameters: Type.Object({}),
    async execute() {
      return {
        content: [{ type: "text", text: "Parent-owned search completed." }],
        details: {},
      };
    },
  });
}
