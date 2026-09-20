import { configureBasicDelegation } from "../provider-support.ts";

export const namedAgent: Scenario = {
  name: "named-agent",
  process: {
    agentDefinitions: {
      security: [
        "---",
        "description: Review permission boundaries",
        "display_name: Security reviewer",
        "tools: [read]",
        "available_skills: [research, tdd, hidden]",
        "preload_skills: [research]",
        "inherit_context: false",
        "interactive: true",
        "---",
        "Return evidence with affected file paths.",
      ].join("\n"),
    },
    managed: true,
    positionalPrompt: "Launch the security reviewer now.",
    skillFiles: {
      "research/SKILL.md": [
        "---",
        "name: research",
        "description: Research trusted sources",
        "---",
        "# Research",
      ].join("\n"),
      "tdd/SKILL.md": [
        "---",
        "name: tdd",
        "description: Test-driven development",
        "---",
        "# TDD",
      ].join("\n"),
      "hidden/SKILL.md": [
        "---",
        "name: hidden",
        "description: Explicitly selected hidden skill",
        "disableModelInvocation: true",
        "---",
        "# Hidden",
      ].join("\n"),
    },
  },
  configureProvider(context) {
    configureBasicDelegation(context, {
      childSystemPromptIncludes: [
        "Return evidence with affected file paths.",
        '<skill name="research"',
        "<name>tdd</name>",
        "<name>hidden</name>",
      ],
      childSystemPromptOrder: [
        '<skill name="research"',
        "<agent_instructions>",
      ],
      expectedChildInteractive: true,
      childSystemPromptEndsWith:
        "Return evidence with affected file paths.\n</agent_instructions>",
      description: "audit permissions",
      prompt: "Review the permission boundary.",
      subagentType: "security",
    });
  },
  async run(harness: E2EHarness) {
    const childPane = await harness.childPane();
    await harness.waitFor(
      "Child completed its delegated E2E task.",
      15_000,
      childPane,
    );
    const view = await harness.waitFor("Security reviewer", 15_000, childPane);

    harness.assert(
      view.includes("Security reviewer") && view.includes("audit permissions"),
      `Named agent display name or task label is missing.\n${view}`,
    );
    harness.assert(
      view.includes("interactive"),
      `Named lifecycle policy is missing.\n${view}`,
    );
  },
};
