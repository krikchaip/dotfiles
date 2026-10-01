import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { configureBasicDelegation } from "../provider-support.ts";

/**
 * Checks broad, fixed, and relative selection against fresh native skill discovery.
 */
export const freshSkillDiscoveryScenarios: readonly Scenario[] = [
  { name: "all", selection: "true", inherited: true },
  { name: "fixed", selection: "[fresh-only]", inherited: false },
  { name: "relative", selection: "[+fresh-only]", inherited: true },
].map(({ name, selection, inherited }) => ({
  name: `agent-skills-fresh-${name}`,
  process: {
    agentDefinitions: {
      "general-purpose": `---\ntools: [read]\nskills: ${selection}\n---\n`,
    },
    managed: true,
    // Scope trust to this test-owned agent directory; never persist user trust.
    settings: { defaultProjectTrust: "always" },
    skillFiles: {
      "inherited/SKILL.md":
        "---\nname: inherited\ndescription: Parent-visible skill.\n---\nParent instructions.\n",
    },
  },
  configureProvider(context) {
    configureBasicDelegation(context, {
      childSystemPromptIncludes: inherited
        ? ["<name>fresh-only</name>", "<name>inherited</name>"]
        : ["<name>fresh-only</name>"],
      childSystemPromptExcludes: inherited ? [] : ["<name>inherited</name>"],
    });
  },
  async run(harness: E2EHarness) {
    const directory = join(
      harness.workDirectory,
      ".agents",
      "skills",
      "fresh-only",
    );
    mkdirSync(directory, { recursive: true });
    const skillPath = join(directory, "SKILL.md");
    writeFileSync(
      skillPath,
      "---\nname: fresh-only\ndescription: Created after parent startup.\n---\nFresh instructions.\n",
    );
    await harness.sendParent("Delegate this E2E task now.", true);
    await harness.waitFor("SUBAGENT COMPLETED");
    const manifestPath = harness.filesNamed("manifest.json")[0];
    harness.assert(
      manifestPath,
      "The child's frozen skill manifest is missing.",
    );
    harness.assert(
      JSON.parse(harness.read(manifestPath)).skillPaths.includes(
        realpathSync(skillPath),
      ),
      "Fresh skill selection was not frozen for continuation.",
    );
  },
}));
