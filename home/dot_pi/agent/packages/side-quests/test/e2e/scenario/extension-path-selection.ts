import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { configureBasicDelegation } from "../provider-support.ts";

const cases = [
  { name: "pattern", selector: "./probe-dir/*.ts", file: "index.ts" },
  { name: "scan", selector: "./probe-dir", file: "helper.ts" },
  { name: "index", selector: "./probe-dir", file: "index.ts" },
  {
    name: "manifest",
    selector: "./probe-dir",
    file: "chosen.ts",
    manifest: true,
  },
  { name: "bare-project", selector: "probe-dir/index.ts", file: "index.ts" },
  {
    name: "bare-global",
    selector: "probe-dir/index.ts",
    file: "index.ts",
    global: true,
  },
  { name: "dot-project", selector: "./probe-dir/index.ts", file: "index.ts" },
  {
    name: "dot-global",
    selector: "./probe-dir/index.ts",
    file: "index.ts",
    global: true,
  },
  {
    name: "comma",
    selector: "./probe,dir/index.ts",
    file: "index.ts",
    directory: "probe,dir",
  },
  { name: "signed-pattern", selector: "+./probe-dir/*.ts", file: "index.ts" },
] as const;

/**
 * Selectors use the definition scope and freeze native Pi-expanded entrypoints.
 */
export const extensionPathSelectionScenarios: readonly Scenario[] = cases.map(
  (entry) => {
    const global = "global" in entry;
    const directory = "directory" in entry ? entry.directory : "probe-dir";
    const definition = `---\ntools: [read]\nextensions: [${JSON.stringify(entry.selector)}]\n---\n`;
    return {
      name: `agent-extension-path-${entry.name}`,
      process: {
        ...(global
          ? { globalAgentDefinitions: { "general-purpose": definition } }
          : { agentDefinitions: { "general-purpose": definition } }),
        managed: true,
      },
      configureProvider(context) {
        configureBasicDelegation(context);
      },
      async run(harness: E2EHarness) {
        const scope = global
          ? harness.stateDirectory
          : join(harness.workDirectory, ".pi");
        const root = join(scope, directory);
        const marker = join(harness.stateDirectory, "selected-path.txt");
        mkdirSync(root, { recursive: true });
        writeFileSync(
          join(root, entry.file),
          [
            'import { appendFileSync } from "node:fs";',
            `export default () => appendFileSync(${JSON.stringify(marker)}, "selected\\n");`,
          ].join("\n"),
        );
        if ("manifest" in entry) {
          writeFileSync(
            join(root, "package.json"),
            JSON.stringify({ pi: { extensions: ["chosen.ts"] } }),
          );
          writeFileSync(
            join(root, "undeclared.ts"),
            'export default () => { throw new Error("Undeclared extension loaded"); };',
          );
        }
        await harness.sendParent("Delegate the path-selection task.", true);
        await harness.waitForWithout(
          "SUBAGENT COMPLETED",
          "Agent could not launch",
        );
        harness.assert(
          existsSync(marker) && harness.read(marker) === "selected\n",
          "Selected path did not execute exactly once.",
        );
      },
    };
  },
);
