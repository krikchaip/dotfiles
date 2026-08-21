import { configureReopen } from "../provider-support.ts";

export const staleTerminalResponse: Scenario = {
  name: "stale-terminal-response",
  process: { managed: true, positionalPrompt: "Delegate this E2E task now." },
  configureProvider(context) {
    configureReopen(context, {
      launchPrompt:
        "Produce the old response before stale terminal response E2E.",
      resumedFailure: "Synthetic stale terminal failure.",
      resumedPrompt: "Run the stale terminal response E2E.",
    });
  },
  async run(harness: E2EHarness) {
    await harness.waitFor(
      "Agent general-purpose (resumed) :: Reopen the E2E delegated task",
    );
    await harness.childPane();
    await harness.waitFor("Subagent failed:");
    await harness.sendParentKeys("C-o");
    await harness.waitFor("Synthetic stale terminal failure.", 5_000);

    const parent = await harness.capture();
    const failureOffset = parent.lastIndexOf("Subagent failed:");

    harness.assert(
      failureOffset >= 0,
      "The expanded failure result was not visible in the parent pane.",
    );

    const failure = parent.slice(failureOffset);

    harness.assert(
      !failure.includes("Old successful response.") &&
        !failure.includes("Result:"),
      `The expanded failure result substituted an old response.\n${failure}`,
    );

    const terminals = harness.filesNamed("terminal.json");

    harness.assert(
      terminals.length === 1,
      "The stale terminal run did not retain one terminal record.",
    );

    const terminal = harness.read(terminals[0]);

    harness.assert(
      !terminal.includes("Old successful response.") &&
        !terminal.includes('"response":'),
      "The stale terminal failure persisted an old response.",
    );
  },
};
