import { fauxAssistantMessage } from "@earendil-works/pi-ai";

import { configureBasicDelegation } from "../provider-support.ts";

export const failure: Scenario = {
  name: "failure",
  process: { managed: true, positionalPrompt: "Delegate this E2E task now." },
  configureProvider(context) {
    if (context.role === "parent") {
      configureBasicDelegation(context, {
        prompt: "Produce the autonomous failure E2E.",
      });
      return;
    }
    context.faux.setResponses([
      fauxAssistantMessage("Synthetic autonomous child failure.", {
        stopReason: "error",
        errorMessage: "Synthetic autonomous child failure.",
      }),
    ]);
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("SUBAGENT FAILED");
  },
};
