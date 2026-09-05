import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "branch-merge-e2e";
const SUMMARY = "## Goal\nMerged exact goal\n\n## Constraints & Preferences\nKeep baseline\n\n## Progress\n- Done: delta\n\n## Key Decisions\n- Preserve provenance\n\n## Next Steps\n1. Continue\n\n## Critical Context\nBASELINE_COMPACTION and NEW_DELTA";

export default function branchMergeProvider(pi: ExtensionAPI): void {
  const delay = Number(process.env.PI_E2E_BRANCH_MERGE_DELAY ?? "0");
  let callCount = 0;
  const faux = registerFauxProvider({
    provider: PROVIDER,
    models: [{ id: "fake", reasoning: false }],
    tokensPerSecond: delay > 0 ? 2 : undefined,
  });
  const response = (context: unknown) => {
    callCount++;
    const path = process.env.PI_E2E_BRANCH_MERGE_CAPTURE;
    if (path) appendFileSync(path, `${JSON.stringify(context)}\n`);

    const mutatePath = process.env.PI_E2E_BRANCH_MERGE_MUTATE_PATH;
    const markerPath = process.env.PI_E2E_BRANCH_MERGE_MUTATE_MARKER;
    if (mutatePath && markerPath && !existsSync(markerPath)) {
      writeFileSync(markerPath, "mutated\n");
      appendFileSync(
        mutatePath,
        `${JSON.stringify({
          type: "session_info",
          id: `concurrent-${Date.now()}`,
          parentId: null,
          timestamp: new Date().toISOString(),
          name: "Concurrent mutation",
        })}\n`,
      );
    }

    if (callCount === 2) {
      if (process.env.PI_E2E_BRANCH_MERGE_FAIL_LABEL === "1") {
        throw new Error("E2E label generation failure");
      }
      return fauxAssistantMessage("Generated Feature Label");
    }
    return fauxAssistantMessage(delay > 0 ? `${SUMMARY}\n${"slow ".repeat(100)}` : SUMMARY);
  };
  faux.setResponses([response, response]);
  pi.registerProvider(PROVIDER, {
    name: "Branch Merge E2E",
    baseUrl: `faux://${PROVIDER}`,
    apiKey: "test",
    api: faux.api,
    models: [{
      id: "fake",
      name: "Fake",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 16_384,
      maxTokens: 2_048,
    }],
  });
}
