import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Exits the real child process only after the scenario signals a completed launch.
 */
export default function fatalProcessExit(pi: ExtensionAPI): void {
  if (!process.env.PI_SIDE_QUESTS_CHILD_ID) return;
  const stateDirectory = process.env.PI_CODING_AGENT_DIR;

  if (!stateDirectory)
    throw new Error("Missing test-owned Pi state directory.");
  const marker = join(stateDirectory, "fatal-process-exit");

  let timer: ReturnType<typeof setInterval> | undefined;

  pi.on("session_start", () => {
    timer = setInterval(() => {
      if (existsSync(marker)) process.exit(17);
    }, 20);
    timer.unref();
  });

  pi.on("session_shutdown", () => {
    if (timer) clearInterval(timer);
  });
}
