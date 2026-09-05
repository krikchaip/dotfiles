import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function sessionTopologyProbe(pi: ExtensionAPI): void {
  pi.registerCommand("e2e-leaf", {
    description: "Report the active E2E session leaf",
    handler: async (_args, context) => {
      const lastMessage = context.sessionManager
        .getBranch()
        .findLast((entry) => entry.type === "message");
      context.ui.notify(
        `E2E LEAF ${context.sessionManager.getLeafId() ?? "null"} LAST MESSAGE ${lastMessage?.id ?? "null"}`,
        "info",
      );
    },
  });

  pi.registerCommand("e2e-navigate", {
    description: "Navigate to one E2E session entry",
    handler: async (args, context) => {
      const result = await context.navigateTree(args.trim(), { summarize: false });
      context.ui.notify(
        result.cancelled ? "E2E NAVIGATE CANCELLED" : `E2E NAVIGATED ${args.trim()}`,
        result.cancelled ? "warning" : "info",
      );
    },
  });

  pi.on("session_start", (_event, context) => {
    if (context.mode !== "tui") return;
    const header = context.sessionManager.getHeader();
    context.ui.setWidget("session-topology-e2e", [
      `SESSION TOPOLOGY READY ${header?.id ?? "ephemeral"}`,
    ]);
  });

  pi.on("session_tree", () => {
    const markerPath = process.env.PI_E2E_TREE_EVENT;
    if (markerPath) appendFileSync(markerPath, "session_tree\n");
  });
}
