import { writeFileSync } from "node:fs";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "session-topology-e2e";

export default function sessionTopologyProvider(pi: ExtensionAPI): void {
  const delayMs = Number.parseInt(process.env.PI_E2E_PROVIDER_DELAY_MS ?? "0", 10);
  const faux = registerFauxProvider({
    provider: PROVIDER,
    models: [{ id: "fake", reasoning: false }],
    tokensPerSecond: delayMs > 0 ? 2 : undefined,
  });
  faux.setResponses([
    () => {
      const activePath = process.env.PI_E2E_PROVIDER_ACTIVE;
      if (activePath) writeFileSync(activePath, "active\n");
      return fauxAssistantMessage(fauxText("SESSION TOPOLOGY PROVIDER RESPONSE"));
    },
  ]);

  pi.registerProvider(PROVIDER, {
    name: "Session Topology E2E",
    baseUrl: `faux://${PROVIDER}`,
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
