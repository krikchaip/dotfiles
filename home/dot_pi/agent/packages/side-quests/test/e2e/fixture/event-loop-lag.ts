import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SAMPLE_INTERVAL_MS = 10;
const PARENT_CONTEXT_BYTES = 8 * 1024 * 1024;

export default function eventLoopLagFixture(pi: ExtensionAPI): void {
  if (process.env.PI_SIDE_QUESTS_CHILD_ID) return;

  let expectedAt = performance.now() + SAMPLE_INTERVAL_MS;
  let maximumLagMs = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  const sample = () => {
    const now = performance.now();
    maximumLagMs = Math.max(maximumLagMs, now - expectedAt);
    expectedAt = now + SAMPLE_INTERVAL_MS;
  };

  pi.on("session_start", () => {
    pi.appendEntry("side-quests-e2e-context", {
      padding: "x".repeat(PARENT_CONTEXT_BYTES),
    });
    timer = setInterval(sample, SAMPLE_INTERVAL_MS);
  });

  pi.on("before_agent_start", () => {
    maximumLagMs = 0;
    expectedAt = performance.now() + SAMPLE_INTERVAL_MS;
  });

  pi.on("tool_execution_end", (event) => {
    if (event.toolName === "Agent") sample();
  });

  pi.on("agent_settled", () => {
    const stateDirectory = process.env.PI_CODING_AGENT_DIR;
    if (!stateDirectory) throw new Error("Missing E2E state directory.");
    writeFileSync(
      join(stateDirectory, "parent-event-loop-lag.json"),
      `${JSON.stringify({ maximumLagMs })}\n`,
    );
  });

  pi.on("session_shutdown", () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  });
}
