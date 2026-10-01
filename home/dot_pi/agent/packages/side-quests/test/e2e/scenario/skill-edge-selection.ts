import { configureBasicDelegation } from "../provider-support.ts";

const skillFiles = {
  "research/SKILL.md":
    "---\nname: research\ndescription: Parent-visible research skill.\n---\nRESEARCH EDGE INSTRUCTIONS\n",
  "hidden/SKILL.md":
    "---\nname: hidden\ndescription: Explicitly selectable hidden skill.\ndisable-model-invocation: true\n---\nHIDDEN EDGE INSTRUCTIONS\n",
};

/**
 * Records the observed native prompt behavior for skill edge cases.
 */
export const skillEdgeSelectionScenarios: readonly Scenario[] = [
  {
    name: "preload-only",
    tools: "[read]",
    selection: "[++research]",
    includes: ['<skill name="research"', "RESEARCH EDGE INSTRUCTIONS"],
    excludes: ["<name>research</name>", "<name>hidden</name>"],
  },
  {
    name: "hidden-signed",
    tools: "[read]",
    selection: "[+hidden]",
    includes: ["<name>hidden</name>", "<name>research</name>"],
    excludes: ["HIDDEN EDGE INSTRUCTIONS"],
  },
  {
    name: "hidden-broad-excluded",
    tools: "[read]",
    selection: "true",
    includes: ["<name>research</name>"],
    excludes: ["<name>hidden</name>", "HIDDEN EDGE INSTRUCTIONS"],
  },
  {
    name: "lazy-no-read",
    tools: "false",
    selection: "[research]",
    includes: [],
    excludes: ["<name>research</name>", "RESEARCH EDGE INSTRUCTIONS"],
    warning: true,
  },
  {
    name: "preload-no-read",
    tools: "false",
    selection: "[++research]",
    includes: ['<skill name="research"', "RESEARCH EDGE INSTRUCTIONS"],
    excludes: ["<name>research</name>"],
  },
].map((row) => ({
  name: `agent-skills-edge-${row.name}`,
  process: {
    agentDefinitions: {
      "general-purpose": `---\ntools: ${row.tools}\nskills: ${row.selection}\n---\n`,
    },
    managed: true,
    skillFiles,
    positionalPrompt: "Delegate the skill edge-case task.",
  },
  configureProvider(context) {
    configureBasicDelegation(context, {
      childSystemPromptIncludes: row.includes,
      childSystemPromptExcludes: row.excludes,
    });
  },
  async run(harness: E2EHarness) {
    const view = await harness.waitFor("SUBAGENT COMPLETED");
    harness.assert(
      /tool\s+policy\s+lacks\s+read/.test(view) === !!row.warning,
      "The missing-read warning did not match the selected lazy/preload policy.",
    );
  },
}));

/**
 * Invalid lazy/preload expressions must fail before retaining launch resources.
 */
export const skillConflictScenarios: readonly Scenario[] = [
  { name: "fixed", selection: "[research, ++research]" },
  { name: "signed", selection: "[+research, ++research]" },
  { name: "preload-duplicate", selection: "[++research, ++research]" },
].map((row) => ({
  name: `agent-skills-conflict-${row.name}`,
  process: {
    agentDefinitions: {
      "general-purpose": `---\ntools: [read]\nskills: ${row.selection}\n---\n`,
    },
    fauxProvider: true,
    skillFiles,
    positionalPrompt: "Attempt the malformed skill selection.",
  },
  configureProvider(context) {
    configureBasicDelegation(context);
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("The delegated work is in progress.");
    const view = await harness.capture();
    harness.assert(
      view.includes("is malformed"),
      "Malformed skill expression was not rejected.",
    );
    harness.assert(
      harness.filesNamed("manifest.json").length === 0 &&
        (await harness.childPanes()).length === 0,
      "Malformed skill expression retained a child manifest or pane.",
    );
  },
}));
