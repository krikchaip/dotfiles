import { configureContinuation } from "../provider-support.ts";

export const activePromotionRejection: Scenario = {
  name: "active-promotion-rejection",
  process: { managed: true, positionalPrompt: "Delegate this E2E task now." },
  configureProvider(context) {
    configureContinuation(context, {
      childFirstResponse: "First active promotion phase settled.",
      childFirstResponseDelayMs: 8_000,
      childSecondResponse: "Promoted active continuation applied.",
      continuationDelayMs: 500,
      continuationPrompt: "Apply the promoted active continuation now.",
      launchPrompt: "Start active promotion E2E.",
      promoteOnContinuation: true,
      waitForActiveBeforeContinuation: true,
    });
  },
  async run(harness: E2EHarness) {
    await harness.waitFor(
      "Agent.resume cannot include subagent_type, inherit_context, or interactive.",
    );

    const childPane = await harness.childPane();
    const manifest = harness.filesNamed("manifest.json")[0];
    const activity = harness.filesNamed("activity.json")[0];
    const session = harness.filesNamed("session.jsonl")[0];

    harness.assert(manifest, "The autonomous child manifest is missing.");
    harness.assert(activity, "The autonomous child activity state is missing.");
    harness.assert(session, "The autonomous child session is missing.");
    harness.assert(
      harness.read(manifest).includes('"lifecycle":"autonomous"'),
      "A rejected active resume changed the child lifecycle.",
    );
    harness.assert(
      harness.read(activity).includes('"phase":"active"'),
      "The child was no longer active when the invalid resume was rejected.",
    );
    harness.assert(
      !harness
        .read(session)
        .includes("Apply the promoted active continuation now."),
      "A rejected active resume delivered its continuation.",
    );

    await harness.waitFor("SUBAGENT COMPLETED");

    harness.assert(
      !(await harness.childPanes()).includes(childPane),
      "The autonomous child pane remained open after completion.",
    );
  },
};
