import { configureReopen } from "../provider-support.ts";

export const resumePromotion: Scenario = {
  name: "resume-promotion",
  process: { managed: true, positionalPrompt: "Delegate this E2E task now." },
  configureProvider(context) {
    configureReopen(context, {
      launchPrompt: "Complete before resume promotion E2E.",
      promoteInteractive: true,
      resumedPrompt: "Run the reopened E2E task.",
    });
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("Subagent reopened. Session:");

    const childPane = await harness.childPane();
    const manifest = harness.filesNamed("manifest.json")[0];

    harness.assert(manifest, "The resumed child manifest is missing.");
    harness.assert(
      harness.read(manifest).includes('"lifecycle":"interactive"'),
      "Explicit Agent.resume did not permanently promote the stopped child.",
    );

    await Bun.sleep(1_000);

    const live = (
      await harness.tmux("display-message", "-p", "-t", childPane, "#{pane_id}")
    ).trim();

    harness.assert(
      live === childPane,
      "Explicit Agent.resume promotion did not keep the child pane open.",
    );

    await harness.sendLiteral(childPane, "/subagent-done", true);
    await harness.waitFor("Subagent completed:");
  },
};
