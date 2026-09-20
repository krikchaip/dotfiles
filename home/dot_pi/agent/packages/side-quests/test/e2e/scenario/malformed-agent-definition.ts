export const malformedAgentDefinition: Scenario = {
  name: "malformed-agent-definition",
  process: {
    agentDefinitions: {
      security: "---\ndescription: 42\n---\n",
    },
  },
  async run(harness: E2EHarness) {
    const view = await harness.waitFor(
      "Side Quests ignored malformed agent definition",
      8_000,
    );

    harness.assert(
      view.includes("security.md") && view.includes("description"),
      `Malformed definition notification lacks its file or reason.\n${view}`,
    );
  },
};
