import { configureReopen } from "../provider-support.ts";

export const resumePromotionRejection: Scenario = {
  name: "resume-promotion-rejection",
  process: { managed: true, positionalPrompt: "Delegate this E2E task now." },
  configureProvider(context) {
    configureReopen(context, {
      launchPrompt: "Complete before resume promotion E2E.",
      promoteInteractive: true,
      resumedPrompt: "Run the reopened E2E task.",
    });
  },
  async run(harness: E2EHarness) {
    await harness.waitFor(
      "Agent.resume cannot include subagent_type, inherit_context, or interactive.",
    );

    const manifest = harness.filesNamed("manifest.json")[0];
    const session = harness.filesNamed("session.jsonl")[0];

    harness.assert(manifest, "The stopped child manifest is missing.");
    harness.assert(session, "The stopped child session is missing.");
    harness.assert(
      harness.read(manifest).includes('"lifecycle":"autonomous"'),
      "A rejected stopped resume changed the child lifecycle.",
    );
    harness.assert(
      !harness.read(session).includes("Run the reopened E2E task."),
      "A rejected stopped resume delivered its continuation.",
    );
    harness.assert(
      (await harness.childPanes()).length === 0,
      "A rejected stopped resume reopened the child pane.",
    );
  },
};
