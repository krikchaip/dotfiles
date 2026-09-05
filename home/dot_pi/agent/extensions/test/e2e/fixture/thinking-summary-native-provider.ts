import {
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
} from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "thinking-summary-native-e2e";

export default function thinkingSummaryNativeProvider(pi: ExtensionAPI): void {
  const faux = registerFauxProvider({
    provider: PROVIDER,
    models: [{ id: "fake", reasoning: true }],
    tokensPerSecond: 80,
    tokenSize: { min: 1, max: 1 },
  });
  faux.setResponses([
    fauxAssistantMessage([
      fauxThinking(
        "# Native first summary\nPRIVATE NATIVE FIRST DETAIL " +
          "slow-detail ".repeat(18),
      ),
      fauxText("NATIVE VISIBLE BETWEEN"),
      fauxThinking(
        "**Native late summary**\nPRIVATE NATIVE LATE DETAIL " +
          "late-detail ".repeat(12),
      ),
      fauxText("NATIVE VISIBLE AFTER"),
    ]),
    fauxAssistantMessage(
      [fauxThinking("Native length summary\nPRIVATE LENGTH DETAIL"), fauxText("NATIVE LENGTH TEXT")],
      { stopReason: "length" },
    ),
    fauxAssistantMessage(
      [fauxThinking("Native abort summary\nPRIVATE ABORT DETAIL")],
      { stopReason: "aborted", errorMessage: "NATIVE CUSTOM ABORT" },
    ),
    fauxAssistantMessage(
      [fauxThinking("Native error summary\nPRIVATE ERROR DETAIL")],
      { stopReason: "error", errorMessage: "NATIVE PROVIDER ERROR" },
    ),
  ]);

  pi.registerProvider(PROVIDER, {
    name: "Thinking Summary Native E2E",
    baseUrl: `faux://${PROVIDER}`,
    apiKey: "test",
    api: faux.api,
    models: [
      {
        id: "fake",
        name: "Fake",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8_192,
        maxTokens: 512,
      },
    ],
  });
}
