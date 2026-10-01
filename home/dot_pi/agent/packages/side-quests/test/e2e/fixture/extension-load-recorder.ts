import { appendFileSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Records each parent or child execution of this extension factory. */
export default function recordExtensionLoad(_pi: ExtensionAPI): void {
  const stateDirectory = process.env.PI_CODING_AGENT_DIR;
  if (!stateDirectory) throw new Error("Missing Pi state directory.");

  appendFileSync(
    join(stateDirectory, "extension-loads.txt"),
    process.env.PI_SIDE_QUESTS_CHILD_ID ? "child\n" : "parent\n",
  );
}
