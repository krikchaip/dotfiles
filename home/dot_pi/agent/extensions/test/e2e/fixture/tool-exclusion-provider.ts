import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "tool-exclusion-e2e";

export default function toolExclusionProvider(pi: ExtensionAPI): void {
  const baseUrl = process.env.PI_E2E_TOOL_EXCLUSION_BASE_URL;
  if (!baseUrl) {
    throw new Error("PI_E2E_TOOL_EXCLUSION_BASE_URL is required.");
  }

  pi.registerProvider(PROVIDER, {
    name: "Tool Exclusion E2E",
    baseUrl,
    apiKey: "test",
    api: "pi-messages",
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

  const registerFixtureTool = (name: string) => {
    pi.registerTool({
      name,
      label: name,
      description: `E2E namespace-proxy fixture: ${name}`,
      parameters: Type.Object({}),
      execute: async () => ({ content: [], details: undefined }),
    });
  };

  for (const name of [
    "mcp__github",
    "mcp__github__search",
    "MCP__GITHUB",
    "literal*",
    "literalX",
    "exact_name",
    "prefix_exact_name",
    "exact_name_suffix",
    "still_available",
  ]) {
    registerFixtureTool(name);
  }

  let lateToolRegistered = false;
  pi.on("context", () => {
    if (lateToolRegistered) return;
    lateToolRegistered = true;
    registerFixtureTool("mcp__github__late");
  });
}
