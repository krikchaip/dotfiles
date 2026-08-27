import { configureReopen } from "../provider-support.ts";

const FINAL_RESPONSE = "Reopened tool work completed.";

export const terminatedToolReopen: Scenario = {
  name: "terminated-tool-reopen",
  process: {
    extensionFixtures: ["test/e2e/fixture/terminating-tool.ts"],
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
    settings: { retry: { enabled: true, maxRetries: 2, baseDelayMs: 10 } },
  },
  configureProvider(context) {
    configureReopen(context, {
      launchPrompt: "Complete before terminated-tool reopen E2E.",
      resumedPrompt: "Run the reopened task through its terminating tool.",
      resumedResponse: FINAL_RESPONSE,
      resumedResponseDelayMs: 750,
      resumedRetryFailures: [
        "Retryable provider failure 1: rate limit exceeded.",
        "Retryable provider failure 2: rate limit exceeded.",
      ],
      resumedTool: "e2e_terminating_tool",
    });
  },
  async run(harness: E2EHarness) {
    await harness.waitFor(
      "Agent general-purpose (resumed) :: Reopen the E2E delegated task",
    );
    await harness.waitForStoredText(FINAL_RESPONSE);
    await harness.waitFor("SUBAGENT COMPLETED");

    const terminals = harness.filesNamed("terminal.json");
    harness.assert(
      terminals.length === 1,
      "Terminated-tool reopen did not retain one terminal record.",
    );
    harness.assert(
      harness
        .read(terminals[0])
        .includes(`\"response\":${JSON.stringify(FINAL_RESPONSE)}`),
      "Terminated-tool reopen completed before its final response.",
    );
  },
};
