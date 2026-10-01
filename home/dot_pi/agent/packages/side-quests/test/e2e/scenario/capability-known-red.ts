import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  configureBasicDelegation,
  fauxSubagentDone,
} from "../provider-support.ts";

/**
 * An explicit hidden skill must be visible in the child's lazy skill catalog.
 * Known red from the real-Pi provider-request probe; production fix needs approval.
 */
export const hiddenSkillExplicitSelection: Scenario = {
  name: "agent-skills-hidden-explicit-known-red",
  process: {
    agentDefinitions: {
      "general-purpose": "---\ntools: [read]\nskills: [hidden]\n---\n",
    },
    managed: true,
    positionalPrompt: "Delegate the hidden-skill task.",
    skillFiles: {
      "hidden/SKILL.md":
        "---\nname: hidden\ndescription: Explicitly selectable hidden skill.\ndisable-model-invocation: true\n---\nHidden skill instructions.\n",
    },
  },
  configureProvider(context) {
    if (context.role === "parent") {
      configureBasicDelegation(context);
      return;
    }
    context.faux.setResponses([
      (request) => {
        const state = process.env.PI_CODING_AGENT_DIR;
        if (!state)
          throw new Error(
            "Hidden-skill probe has no isolated state directory.",
          );
        writeFileSync(
          join(state, "hidden-skill-request.json"),
          JSON.stringify({
            selected: (request.systemPrompt ?? "").includes(
              "<name>hidden</name>",
            ),
          }),
        );
        return fauxSubagentDone("Hidden skill request recorded.");
      },
    ]);
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("SUBAGENT COMPLETED");
    const result = JSON.parse(
      harness.read(join(harness.stateDirectory, "hidden-skill-request.json")),
    );
    harness.assert(
      result.selected,
      "Explicit hidden skill is missing from the real child provider request.",
    );
  },
};

/**
 * Two paths to one extension through a symlink must not execute it twice.
 * Known red from the /tmp versus /private/tmp live probe; fix needs approval.
 */
export const extensionCanonicalAliasConflict: Scenario = {
  name: "agent-extension-canonical-alias-known-red",
  process: {
    fauxProvider: true,
    positionalPrompt: "Delegate the canonical-alias task.",
  },
  async prepare(harness) {
    const scope = join(harness.workDirectory, ".pi");
    const directory = join(scope, "fixture");
    mkdirSync(join(scope, "agents"), { recursive: true });
    mkdirSync(directory);
    symlinkSync(directory, join(scope, "alias"), "dir");
    writeFileSync(join(directory, "selected.ts"), "export default () => {};\n");
    writeFileSync(
      join(scope, "agents", "general-purpose.md"),
      "---\ntools: [read]\nextensions: [./fixture/selected.ts, ./alias/selected.ts]\n---\n",
    );
  },
  configureProvider(context) {
    configureBasicDelegation(context);
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("The delegated work is in progress.");
    harness.assert(
      harness.filesNamed("manifest.json").length === 0 &&
        (await harness.childPanes()).length === 0,
      "Equivalent extension paths launched a child instead of rejecting the duplicate identity.",
    );
  },
};
