import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function newChildStartupFailure(pi: ExtensionAPI): void {
  pi.registerCommand("e2e-break-child-startup", {
    description: "Make the next child Pi process fail during startup",
    handler: async (_args, context) => {
      process.env.PI_CODING_AGENT_DIR = "/dev/null/pi-agent";
      context.ui.notify("E2E child startup will fail", "info");
    },
  });
}
