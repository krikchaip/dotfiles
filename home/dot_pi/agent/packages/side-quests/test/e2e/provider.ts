import { basename } from "node:path";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { scenarioByName } from "./scenarios.ts";

function selectedScenarioName(): string {
  const explicit = process.env.SIDE_QUESTS_E2E_SCENARIO;
  if (explicit) return explicit;

  const stateDirectory = process.env.PI_CODING_AGENT_DIR;
  if (!stateDirectory)
    throw new Error("The E2E provider has no scenario or state directory.");

  const stateName = basename(stateDirectory);
  if (!stateName.endsWith("-state"))
    throw new Error(`Cannot derive an E2E scenario from ${stateDirectory}.`);

  return stateName.slice(0, -"-state".length);
}

/** Registers the deterministic provider script owned by the selected scenario. */
export default function installE2eProvider(pi: ExtensionAPI): void {
  const name = selectedScenarioName();

  const scenario = scenarioByName(name);
  if (!scenario?.configureProvider)
    throw new Error(`E2E scenario has no provider script: ${name}`);

  const faux = registerFauxProvider({
    provider: "side-quests-e2e",
    models: [{ id: "fake", reasoning: false }],
  });

  scenario.configureProvider({
    faux,
    initialPrompt: process.env.PI_SIDE_QUESTS_INITIAL_PROMPT ?? "",
    role: process.env.PI_SIDE_QUESTS_CHILD_ID ? "child" : "parent",
  });

  pi.registerProvider("side-quests-e2e", {
    name: "Side Quests E2E",
    baseUrl: "faux://side-quests-e2e",
    apiKey: "test",
    api: faux.api,
    models: [
      {
        id: "fake",
        name: "Fake",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8_192,
        maxTokens: 256,
      },
    ],
  });
}
