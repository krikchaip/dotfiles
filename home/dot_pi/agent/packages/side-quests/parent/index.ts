import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createParentRuntime } from "./runtime.ts";
import { installParentUi } from "./ui.ts";

/** Compose the parent-only runtime and UI surfaces. */
export function installParent(pi: ExtensionAPI): void {
  const runtime = createParentRuntime(pi);
  installParentUi(runtime);
}
