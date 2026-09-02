import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { configureBasicDelegation } from "../provider-support.ts";

export const windowTitleFinalPaneClose: Scenario = {
  name: "window-title-final-pane-close",
  process: {
    lifecycle: "interactive",
    managed: true,
    positionalPrompt: "Delegate the final-pane title E2E task now.",
    tmuxFixture: "test/e2e/fixture/title-selection-race.sh",
  },
  timeoutMs: 30_000,
  configureProvider(context) {
    configureBasicDelegation(context, {
      description: "Final pane title E2E",
      interactive: true,
      prompt: "Wait for explicit completion of the only managed pane.",
    });
  },
  async run(harness: E2EHarness) {
    const childPane = await harness.childPane();
    await harness.waitFor("[Extensions]", 15_000, childPane);

    const armPath = join(harness.stateDirectory, "title-selection-race.arm");
    const selectedPath = join(
      harness.stateDirectory,
      "title-selection-race.selected",
    );
    const releasePath = join(
      harness.stateDirectory,
      "title-selection-race.release",
    );
    const beforeCompletion = harness.read(harness.logPath);

    writeFileSync(armPath, "armed\n");
    await harness.waitUntil(
      "title selection to finish before final-pane closure",
      () => existsSync(selectedPath),
      5_000,
    );

    try {
      await harness.sendLiteral(childPane, "/subagent-done", true);
      await harness.waitUntil(
        "completed final managed pane to close",
        async () => (await harness.childPanes()).length === 0,
        10_000,
      );
    } finally {
      writeFileSync(releasePath, "release\n");
    }

    await harness.waitFor("SUBAGENT COMPLETED", 15_000);
    await Bun.sleep(1_200);

    const completionOutput = harness
      .read(harness.logPath)
      .slice(beforeCompletion.length);
    harness.assert(
      !completionOutput.includes(
        "Side Quests could not update the tmux window title",
      ),
      `Completing the only managed pane emitted a false title warning.\n\n${completionOutput}`,
    );
  },
};
