import { fileURLToPath } from "node:url";

import { configureBasicDelegation } from "../provider-support.ts";

const extensionPath = fileURLToPath(
  new URL("../fixture/extension-startup-failure.ts", import.meta.url),
);

/**
 * Proves a selected factory failure reports its path and removes launch state.
 */
export const extensionStartupFailure: Scenario = {
  name: "agent-extension-startup-failure",
  process: {
    agentDefinitions: {
      "general-purpose": [
        "---",
        "tools: [read]",
        `extensions: [${JSON.stringify(extensionPath)}]`,
        "---",
      ].join("\n"),
    },
    expectedExtensionFactoryFailure: true,
    // Launch failure must remove the session, unlike a managed success run.
    fauxProvider: true,
    positionalPrompt: "Delegate this E2E task now.",
  },
  configureProvider(context) {
    configureBasicDelegation(context);
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("E2E selected extension factory exploded");
    await harness.waitFor("extension-startup-failure.ts");
    const panes = await harness.childPanes();
    harness.assert(panes.length === 0, "Failed child pane was retained.");
    harness.assert(
      harness.filesNamed("manifest.json").length === 0,
      "Failed child manifest was retained.",
    );
    harness.assert(
      harness.filesNamed("session.jsonl").length === 0,
      "Failed child session was retained.",
    );
    harness.assert(
      !(await harness.capture()).includes("SUBAGENT COMPLETED"),
      "Failed extension startup was reported as successful completion.",
    );
  },
};
