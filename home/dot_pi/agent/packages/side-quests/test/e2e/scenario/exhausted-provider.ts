import { fauxAssistantMessage } from "@earendil-works/pi-ai";

import { configureBasicDelegation } from "../provider-support.ts";

export const exhaustedProvider: Scenario = {
  name: "exhausted-provider",
  process: {
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
    settings: { retry: { enabled: true, maxRetries: 2, baseDelayMs: 10 } },
  },
  configureProvider(context) {
    if (context.role === "parent") {
      configureBasicDelegation(context, {
        prompt: "Exhaust provider retry E2E.",
      });
      return;
    }
    context.faux.setResponses(
      [1, 2, 3].map((attempt) =>
        fauxAssistantMessage(
          `Provider retry exhausted (attempt ${attempt}): rate limit exceeded.`,
          {
            stopReason: "error",
            errorMessage: `Provider retry exhausted (attempt ${attempt}): rate limit exceeded.`,
          },
        ),
      ),
    );
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("SUBAGENT FAILED");
    for (const attempt of [1, 2, 3])
      harness.assert(
        harness.storedTextContains(
          `Provider retry exhausted (attempt ${attempt}): rate limit exceeded.`,
        ),
        `The provider retry exhaustion did not run attempt ${attempt}.`,
      );
  },
};
