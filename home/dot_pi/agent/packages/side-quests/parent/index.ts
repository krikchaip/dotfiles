import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { ParentRuntime } from "./runtime.ts";
import { ParentTools } from "./tool.ts";
import { installParentUi } from "./ui.ts";

/** Compose the parent runtime, tool, and UI surfaces. */
export function installParent(pi: ExtensionAPI): void {
  const runtime = new ParentRuntime(pi);

  runtime.installEventListeners();

  ParentTools.register(pi, runtime);
  installParentUi(pi, runtime);
}
