import { Type, fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "tool-exclusion-e2e";

export default function toolExclusionProvider(pi: ExtensionAPI): void {
  const capturePath = process.env.PI_E2E_TOOL_EXCLUSION_CAPTURE;
  if (!capturePath) {
    throw new Error("PI_E2E_TOOL_EXCLUSION_CAPTURE is required.");
  }

  const faux = registerFauxProvider({
    provider: PROVIDER,
    models: [{ id: "fake", reasoning: false }],
  });
  faux.setResponses([
    (context: unknown) => {
      writeFileSync(capturePath, JSON.stringify(context, null, 2));
      return fauxAssistantMessage(fauxText("TOOL_EXCLUSION_DONE"));
    },
  ]);

  pi.registerProvider(PROVIDER, {
    name: "Tool Exclusion E2E",
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

  for (const name of ["mcp__github", "mcp__still_available"]) {
    pi.registerTool({
      name,
      label: name,
      description: `E2E namespace-proxy fixture: ${name}`,
      parameters: Type.Object({}),
      execute: async () => ({ content: [], details: undefined }),
    });
  }
}
