import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  configureBasicDelegation,
  configureReopen,
} from "../provider-support.ts";

const extensionPath = fileURLToPath(
  new URL("../fixture/child-only-tool.ts", import.meta.url),
);

/**
 * Broad tool selection includes tools registered only by selected child extensions.
 */
export const extensionAllChildTools: Scenario = {
  name: "agent-tools-all-child-registry",
  process: {
    agentDefinitions: {
      "general-purpose": [
        "---",
        "tools: true",
        `extensions: [${JSON.stringify(extensionPath)}]`,
        "---",
      ].join("\n"),
    },
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
  },
  configureProvider(context) {
    configureBasicDelegation(context, {
      childToolIncludes: ["read", "child_search"],
      childToolExcludes: ["Agent", "Task", "spawn_agent"],
    });
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("SUBAGENT COMPLETED");
    const path = harness.filesNamed("manifest.json")[0];
    harness.assert(path, "Child capability manifest is missing.");
    const manifest = JSON.parse(harness.read(path));
    harness.assert(
      manifest.tools.includes("child_search"),
      "Broad child tool selection was not frozen in the manifest.",
    );
  },
};

/**
 * Proves persisted child-only tools are validated in the reopened child registry.
 */
export const extensionChildToolReopen: Scenario = {
  name: "agent-extension-child-tool-reopen",
  process: {
    agentDefinitions: {
      "general-purpose": [
        "---",
        "tools: [child_search]",
        `extensions: [${JSON.stringify(extensionPath)}]`,
        "---",
      ].join("\n"),
    },
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
  },
  configureProvider(context) {
    configureReopen(context, {
      launchPrompt: "Complete the first child-only-tool task.",
      resumedPrompt: "Use child_search in the reopened task.",
      resumedTool: "child_search",
      resumedResponse: "Child-only extension tool reopened and searched.",
    });
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("└ Resumed");
    await harness.waitForStoredText(
      "Child-only extension tool reopened and searched.",
    );
    await harness.waitFor("SUBAGENT COMPLETED");

    harness.assert(
      harness.read(
        join(harness.stateDirectory, "child-only-tool-loads.txt"),
      ) === "loaded\nloaded\n",
      "The immutable selected extension did not execute once per child generation.",
    );
    harness.assert(
      harness.read(
        join(harness.stateDirectory, "child-only-tool-executions.txt"),
      ) === "searched\n",
      "The child-only tool was not usable after reopen.",
    );
  },
};
