import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { configureBasicDelegation } from "../provider-support.ts";

/**
 * Selecting an already discovered Direct directory must not execute it twice.
 */
export const extensionDirectOverlapScenarios: readonly Scenario[] = [
  { name: "fixed-directory", selector: "./extensions", removed: false },
  { name: "include-directory", selector: "+./extensions", removed: false },
  { name: "remove-directory", selector: "-./extensions", removed: true },
  { name: "fixed-pattern", selector: "./extensions/*.ts", removed: false },
  { name: "include-pattern", selector: "+./extensions/*.ts", removed: false },
  { name: "remove-pattern", selector: "-./extensions/*.ts", removed: true },
  {
    name: "remove-manifest-directory-known-red",
    selector: "-./extensions",
    removed: true,
    manifest: true,
  },
].map((row) => ({
  name: `agent-extension-direct-overlap-${row.name}`,
  process: {
    managed: true,
    positionalPrompt: "Delegate the Direct overlap task.",
    agentDefinitions: {
      "general-purpose": `---\ntools: [read]\nextensions: [${JSON.stringify(row.selector)}]\n---\n`,
    },
  },
  async prepare(harness) {
    writeFileSync(
      join(harness.stateDirectory, "settings.json"),
      JSON.stringify({
        defaultProjectTrust: "always",
        compaction: { enabled: false },
      }),
    );
    const directory = join(harness.workDirectory, ".pi", "extensions");
    mkdirSync(directory, { recursive: true });
    if (row.manifest)
      writeFileSync(
        join(directory, "package.json"),
        JSON.stringify({
          name: "direct-manifest-fixture",
          pi: { extensions: ["helper.ts"] },
        }),
      );
    writeFileSync(
      join(directory, "helper.ts"),
      [
        'import { appendFileSync } from "node:fs";',
        `export default () => appendFileSync(${JSON.stringify(join(harness.stateDirectory, "overlap.txt"))},`,
        '(process.env.PI_SIDE_QUESTS_CHILD_ID ? "child" : "parent") + "\\n");',
      ].join("\n"),
    );
  },
  configureProvider(context) {
    configureBasicDelegation(context);
  },
  async run(harness: E2EHarness) {
    if (row.manifest) {
      const view = await harness.waitFor("The delegated work is in progress.");
      harness.assert(
        !view.includes("does not match the parent set"),
        "Direct manifest directory removal rejected a loaded parent entrypoint.",
      );
    }
    await harness.waitFor("SUBAGENT COMPLETED");
    const actual = harness.read(join(harness.stateDirectory, "overlap.txt"));
    harness.assert(
      actual === (row.removed ? "parent\n" : "parent\nchild\n"),
      `Direct overlap changed the factory count:\n${actual}`,
    );
  },
}));
