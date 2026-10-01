import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";

import { configureBasicDelegation } from "../provider-support.ts";

const extensionPath = fileURLToPath(
  new URL("../fixture/child-only-tool.ts", import.meta.url),
);

/**
 * A project override cannot hide an unknown tool in the global layer.
 */
export const overriddenUnknownGlobalTool: Scenario = {
  name: "agent-overlay-unknown-global-tool",
  process: {
    globalAgentDefinitions: {
      "general-purpose":
        "---\ntools: [missing_global_tool]\nextensions: false\n---\n",
    },
    agentDefinitions: {
      "general-purpose": "---\ntools: [read]\n---\n",
    },
    fauxProvider: true,
    positionalPrompt: "Delegate this E2E task now.",
  },
  configureProvider(context) {
    configureBasicDelegation(context);
    if (context.role === "child")
      context.faux.setResponses([
        () => {
          writeFileSync(
            join(
              process.env.PI_CODING_AGENT_DIR ?? "",
              "rejected-child-provider.txt",
            ),
            "provider called\n",
          );
          return fauxAssistantMessage(
            fauxText("Rejected child reached the provider."),
          );
        },
      ]);
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("The delegated work is in progress.");
    harness.assert(
      !existsSync(join(harness.stateDirectory, "rejected-child-provider.txt")),
      "The rejected child reached a provider request after failed readiness.",
    );
    harness.assert(
      harness.filesNamed("manifest.json").length === 0,
      "A project override hid the unknown global tool and launched a child.",
    );
    const terminal = await harness.capture();
    harness.assert(
      terminal.includes("missing_global_tool") &&
        terminal.includes("general-purpose.md"),
      "The failed launch did not report the unknown tool and its source layer.",
    );
  },
};

/**
 * Deferred lower-layer validation must not widen the final tool allowlist.
 */
export const overriddenValidChildTool: Scenario = {
  name: "agent-overlay-valid-child-tool",
  process: {
    globalAgentDefinitions: {
      "general-purpose": [
        "---",
        "tools: [child_search]",
        `extensions: [${JSON.stringify(extensionPath)}]`,
        "---",
      ].join("\n"),
    },
    agentDefinitions: {
      "general-purpose": "---\ntools: [read]\n---\n",
    },
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
  },
  configureProvider(context) {
    configureBasicDelegation(context, {
      childToolIncludes: ["read"],
      childToolExcludes: ["child_search"],
    });
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("SUBAGENT COMPLETED");
    const path = harness.filesNamed("manifest.json")[0];
    harness.assert(path, "Child manifest is missing.");
    harness.assert(
      JSON.stringify(JSON.parse(harness.read(path)).tools) === '["read"]',
      "Lower-layer validation widened the frozen child tool policy.",
    );
  },
};
