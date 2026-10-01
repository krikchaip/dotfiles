import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { configureBasicDelegation } from "../provider-support.ts";

/**
 * Offline selection ignores unavailable settings packages outside its requested surface.
 */
export const extensionOfflineSelectionScenarios: readonly Scenario[] = [
  { name: "false", selection: "false", removed: false },
  { name: "empty", selection: "[]", removed: false },
  {
    name: "signed-local",
    selection: '["+./extensions/local.ts"]',
    removed: false,
  },
  {
    name: "fixed-local",
    selection: '["./extensions/local.ts"]',
    removed: false,
  },
  {
    name: "signed-removal",
    selection: '["-./extensions/local.ts"]',
    removed: true,
  },
  {
    name: "selected-missing",
    selection: '["npm:side-quests-uncached-fixture@1.0.0"]',
    rejected: true,
  },
  {
    name: "all-missing",
    selection: "true",
    rejected: true,
  },
].map((row) => ({
  name: `agent-extension-offline-${row.name}`,
  process: {
    managed: !row.rejected,
    fauxProvider: true,
    offline: true,
    agentDefinitions: {
      "general-purpose": `---\ntools: [read]\nextensions: ${row.selection}\n---\n`,
    },
  },
  async prepare(harness) {
    writeFileSync(
      join(harness.stateDirectory, "settings.json"),
      JSON.stringify({
        packages: ["npm:side-quests-uncached-fixture@1.0.0"],
        defaultProjectTrust: "always",
        compaction: { enabled: false },
      }),
    );
    const directory = join(harness.workDirectory, ".pi", "extensions");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "local.ts"),
      [
        'import { appendFileSync } from "node:fs";',
        `export default () => appendFileSync(${JSON.stringify(join(harness.stateDirectory, "offline-loads.txt"))},`,
        '(process.env.PI_SIDE_QUESTS_CHILD_ID ? "child" : "parent") + "\\n");',
      ].join("\n"),
    );
  },
  configureProvider: configureBasicDelegation,
  async run(harness: E2EHarness) {
    // Isolate the separate pre-existing child environment propagation defect.
    await harness.tmux("set-environment", "-g", "PI_OFFLINE", "1");
    await harness.waitFor("fake");
    await harness.sendParent("Delegate the offline selection task.", true);
    const view = await harness.waitFor("The delegated work is in progress.");
    if (row.rejected) {
      harness.assert(
        view.includes("has no matching installed resources"),
        "Offline selection of a missing package did not fail closed.",
      );
      harness.assert(
        harness.filesNamed("manifest.json").length === 0 &&
          (await harness.childPanes()).length === 0,
        "Rejected offline selection retained child launch state.",
      );
    } else {
      harness.assert(
        !view.includes("has no matching installed resources"),
        `Offline ${row.name} resolved an unselected settings package.\n${view}`,
      );
      await harness.waitFor("SUBAGENT COMPLETED");
    }
    harness.assert(
      harness.read(join(harness.stateDirectory, "offline-loads.txt")) ===
        (row.removed || row.rejected ? "parent\n" : "parent\nchild\n"),
      "Offline selection changed the requested Direct extension surface.",
    );
  },
}));
