import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";

import { configureBasicDelegation, delay } from "../provider-support.ts";

export const fatalInteractive: Scenario = {
  name: "fatal-interactive",
  process: {
    lifecycle: "interactive",
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
  },
  configureProvider(context) {
    if (context.role === "parent") {
      configureBasicDelegation(context, {
        interactive: true,
        prompt: "Wait for fatal interactive process E2E.",
      });
      return;
    }
    context.faux.setResponses([
      async () => {
        await delay(30_000);
        return fauxAssistantMessage(fauxText("Fatal process survived."));
      },
    ]);
  },
  async run(harness: E2EHarness) {
    const childPane = await harness.childPane();
    const remain = (
      await harness.tmux(
        "show-options",
        "-pv",
        "-t",
        childPane,
        "remain-on-exit",
      )
    ).trim();

    harness.assert(
      remain === "failed",
      "The managed child pane did not retain nonzero process exits.",
    );

    await harness.tmux("respawn-pane", "-k", "-t", childPane, "exit 17");
    await harness.waitFor("Subagent failed:");
    await harness.sendParentKeys("C-o");
    await harness.waitFor("Child process exited with status 17.", 5_000);
  },
};
