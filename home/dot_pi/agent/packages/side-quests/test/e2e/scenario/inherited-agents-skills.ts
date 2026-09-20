import { configureBasicDelegation } from "../provider-support.ts";

const skill = (name: string, instruction: string) =>
  [
    "---",
    `name: ${name}`,
    `description: ${name} test skill`,
    "---",
    instruction,
  ].join("\n");

/**
 * Proves omitted available_skills preserves parent skills discovered from .agents.
 */
export const inheritedAgentsSkills: Scenario = {
  name: "agent-inherits-agents-skills",
  process: {
    agentSkillFiles: {
      "agents-project/SKILL.md": skill(
        "agents-project",
        "AGENTS PROJECT SKILL INSTRUCTION",
      ),
    },
    managed: true,
    positionalPrompt: "Launch a child with the inherited parent skill catalog.",
    settings: { defaultProjectTrust: "always" },
    skillFiles: {
      "native-global/SKILL.md": skill(
        "native-global",
        "NATIVE GLOBAL SKILL INSTRUCTION",
      ),
    },
  },
  configureProvider(context) {
    configureBasicDelegation(context, {
      childSystemPromptIncludes: [
        "<name>agents-project</name>",
        "<name>native-global</name>",
      ],
      description: "Inherit parent skills",
      prompt: "Confirm that the full parent skill catalog is available.",
    });
  },
  async run(harness) {
    await harness.waitFor("Child completed its delegated E2E task.", 15_000);
  },
};
