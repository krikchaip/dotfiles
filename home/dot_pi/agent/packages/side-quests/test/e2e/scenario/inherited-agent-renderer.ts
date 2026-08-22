import { configureBasicDelegation } from "../provider-support.ts";

export const inheritedAgentRenderer: Scenario = {
  name: "inherited-agent-renderer",
  process: {
    extensionFixtures: ["test/e2e/fixture/delegating-tool-renderer.ts"],
    managed: true,
    persistSession: true,
    positionalPrompt: "Launch one inherited interactive agent now.",
  },
  configureProvider(context) {
    configureBasicDelegation(context, {
      description: "Live inherited agent session",
      inheritContext: true,
      interactive: true,
      prompt: "Stand by in interactive mode. Await user instructions.",
    });
  },
  async run(harness: E2EHarness) {
    const childPane = await harness.childPane();
    const view = await harness.waitFor(
      "Live inherited agent session",
      15_000,
      childPane,
    );

    harness.assert(
      view.includes("Agent general-purpose :: Live inherited agent session"),
      `The inherited Agent call did not use the canonical summary.\n${view}`,
    );
    harness.assert(
      !view.includes("general-purpose :: general-purpose"),
      `The inherited Agent call repeated its agent type.\n${view}`,
    );
  },
};
