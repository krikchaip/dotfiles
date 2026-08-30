import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import { delay, fauxSubagentDone } from "../provider-support.ts";

export const terminalTakeover: Scenario = {
  name: "terminal-takeover",
  process: {
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
  },
  timeoutMs: 45_000,
  configureProvider({ faux, role }) {
    if (role === "child") {
      return faux.setResponses([
        async () => {
          await delay(5_000);
          return fauxAssistantMessage(fauxText("Autonomous phase settled."));
        },
        fauxAssistantMessage(fauxText("Terminal takeover applied.")),
        fauxSubagentDone("Terminal takeover applied."),
      ]);
    }

    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("Agent", {
          description: "E2E delegated task",
          prompt: "Wait for direct terminal takeover E2E.",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("The delegated work is in progress.")),
    ]);
  },
  async run(harness: E2EHarness) {
    const childPane = await harness.childPane();

    await harness.waitFor("[Extensions]", 15_000, childPane);

    await harness.sendLiteral(
      childPane,
      "Take over this child directly.",
      true,
    );

    await harness.waitUntil(
      "direct terminal input to persist interactive takeover",
      () =>
        harness
          .filesNamed("manifest.json")
          .some((path) =>
            harness.read(path).includes('"lifecycle":"interactive"'),
          ),
    );

    await harness.waitForStoredText("Terminal takeover applied.");

    await harness.sendLiteral(childPane, "/subagent-d");
    await Bun.sleep(500);

    const childView = await harness.capture(childPane);

    harness.assert(
      childView.includes("subagent-done"),
      `Interactive takeover did not refresh /subagent-done autocomplete.\n${childView}`,
    );

    await harness.sendKeys(childPane, "Tab", "Enter");
    await harness.waitFor("SUBAGENT COMPLETED");
  },
};
