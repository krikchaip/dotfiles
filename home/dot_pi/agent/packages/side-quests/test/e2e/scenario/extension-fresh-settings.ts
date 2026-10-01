import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { configureBasicDelegation } from "../provider-support.ts";

/**
 * Proves fresh discovery sees effective package settings changed after startup.
 */
export const extensionFreshSettings: Scenario = {
  name: "agent-extension-fresh-settings",
  process: {
    agentDefinitions: {
      "general-purpose": "---\ntools: [read]\nextensions: true\n---\n",
    },
    managed: true,
  },
  configureProvider(context) {
    configureBasicDelegation(context);
  },
  async run(harness: E2EHarness) {
    const packageDirectory = join(harness.workDirectory, "late-package");
    const marker = join(harness.stateDirectory, "late-package-loaded.txt");
    mkdirSync(packageDirectory);
    writeFileSync(
      join(packageDirectory, "package.json"),
      JSON.stringify({
        name: "late-package",
        pi: { extensions: ["index.ts"] },
      }),
    );
    writeFileSync(
      join(packageDirectory, "index.ts"),
      [
        'import { appendFileSync } from "node:fs";',
        "export default function () {",
        `  appendFileSync(${JSON.stringify(marker)}, "child\\n");`,
        "}",
      ].join("\n"),
    );
    writeFileSync(
      join(harness.stateDirectory, "settings.json"),
      JSON.stringify({ packages: [packageDirectory] }),
    );

    await harness.sendParent("Delegate this E2E task now.", true);
    await harness.waitFor("SUBAGENT COMPLETED");

    harness.assert(
      existsSync(marker) && harness.read(marker) === "child\n",
      "Fresh child discovery ignored package settings changed after parent startup.",
    );
  },
};
