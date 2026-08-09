import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { ParentCommands } from "./command.ts";
import { ParentRuntime } from "./runtime.ts";
import { ParentTools } from "./tool.ts";
import { ParentUI } from "./ui.ts";

/** Compose the parent runtime, tool, and UI surfaces. */
export function installParent(pi: ExtensionAPI): void {
  const runtime = ParentRuntime.register(pi);
  const ui = ParentUI.register(pi, runtime);

  ParentTools.register(pi, runtime);
  ParentCommands.register(pi, runtime, ui);
}
