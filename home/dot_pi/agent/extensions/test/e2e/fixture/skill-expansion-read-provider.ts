import { appendFileSync } from "node:fs";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function skillExpansionReadProvider(pi: ExtensionAPI): void {
  const capturePath = process.env.PI_E2E_SKILL_READ_CAPTURE;
  const skillPath = process.env.PI_E2E_SKILL_READ_PATH;
  if (!capturePath || !skillPath) throw new Error("Missing skill expansion read fixture environment");

  const faux = registerFauxProvider({
    provider: "skill-expansion-read-e2e",
    models: [{ id: "fake", name: "Skill Expansion Read E2E", contextWindow: 16_384, maxTokens: 1_024 }],
  });
  faux.setResponses([
      (context) => {
        appendFileSync(capturePath, `${JSON.stringify(context.messages)}\n`);
        return fauxAssistantMessage(fauxToolCall("read", { path: skillPath }), { stopReason: "toolUse" });
      },
      (context) => {
        appendFileSync(capturePath, `${JSON.stringify(context.messages)}\n`);
        return fauxAssistantMessage("SKILL READ COMPLETE");
      },
    ]);

  pi.registerProvider("skill-expansion-read-e2e", {
    name: "Skill Expansion Read E2E",
    baseUrl: "faux://skill-expansion-read-e2e",
    apiKey: "test",
    api: faux.api,
    models: [{
      id: "fake",
      name: "Skill Expansion Read E2E",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 16_384,
      maxTokens: 1_024,
    }],
  });
}
