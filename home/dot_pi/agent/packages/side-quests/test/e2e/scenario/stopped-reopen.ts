import { configureReopen } from "../provider-support.ts";

export const stoppedReopen: Scenario = {
  name: "stopped-reopen",
  process: { managed: true, positionalPrompt: "Delegate this E2E task now." },
  configureProvider(context) {
    configureReopen(context, {
      launchPrompt: "Complete before stopped reopen E2E.",
      resumedPrompt: "Run the reopened E2E task.",
    });
  },
  async run(harness: E2EHarness) {
    await harness.waitFor(
      "Agent general-purpose (resumed) :: Reopen the E2E delegated task",
    );
    await harness.waitFor("SUBAGENT COMPLETED");
    await harness.sendParentKeys("C-o");
    await harness.waitFor("Reopened run completed.", 5_000);

    const terminals = harness.filesNamed("terminal.json");

    harness.assert(
      terminals.length === 1,
      "Stopped reopen did not retain one current terminal record.",
    );

    const terminal = harness.read(terminals[0]);

    harness.assert(
      terminal.includes('"response":"Reopened run completed."') &&
        !terminal.includes("First run completed before reopen."),
      "Stopped reopen did not persist only its current-run response.",
    );
  },
};
