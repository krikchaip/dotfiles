import {
  fauxAssistantMessage,
  fauxText,
  type FauxProviderState,
} from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "post-compaction-context-e2e";

export default function postCompactionContextProvider(pi: ExtensionAPI): void {
  const faux = registerFauxProvider({
    provider: PROVIDER,
    models: [{ id: "fake", reasoning: false }],
  });
  const respond = (context: unknown, _options: unknown, state: FauxProviderState) => {
    const serialized = JSON.stringify(context);
    const text = serialized.includes("POST CONTEXT AFTER USER")
      ? "POST CONTEXT AFTER RESPONSE"
      : state.callCount <= 1
        ? "POST CONTEXT FIRST RESPONSE"
        : state.callCount === 2
          ? "POST CONTEXT SECOND RESPONSE"
          : "POST CONTEXT COMPACTION SUMMARY";
    return fauxAssistantMessage(fauxText(text));
  };
  faux.setResponses(Array.from({ length: 8 }, () => respond));

  pi.registerProvider(PROVIDER, {
    name: "Post Compaction Context E2E",
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
