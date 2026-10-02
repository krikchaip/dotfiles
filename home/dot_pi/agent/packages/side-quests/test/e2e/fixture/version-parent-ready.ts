import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Records the final parent agent_end event, not a still-streaming text marker.
 */
export default function versionParentReady(pi: ExtensionAPI): void {
  if (process.env.PI_SIDE_QUESTS_CHILD_ID) return;
  pi.on("agent_end", (event) => {
    const complete = event.messages.some(
      (message) =>
        message.role === "assistant" &&
        message.content.some(
          (block) =>
            block.type === "text" &&
            block.text === "VERSION ISOLATION COMPLETE",
        ),
    );
    const state = process.env.PI_CODING_AGENT_DIR;
    if (complete && state)
      writeFileSync(join(state, "version-parent-ready"), "done");
  });
}
