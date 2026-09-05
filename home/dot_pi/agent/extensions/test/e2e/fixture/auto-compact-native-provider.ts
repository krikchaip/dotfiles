import {
  Type,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const PROVIDER = "auto-compact-native-e2e";

function appendCapture(context: unknown): void {
  const path = process.env.PI_E2E_AUTO_COMPACT_CAPTURE;
  if (!path) return;
  const captures = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
  captures.push(context);
  writeFileSync(path, JSON.stringify(captures, null, 2));
}

export default function autoCompactNativeProvider(pi: ExtensionAPI): void {
  const mode = process.env.PI_E2E_AUTO_COMPACT_MODE;
  if (mode !== "tool" && mode !== "final" && mode !== "queue" && mode !== "failure") {
    throw new Error("PI_E2E_AUTO_COMPACT_MODE must be tool, final, queue, or failure");
  }

  const faux = registerFauxProvider({
    provider: PROVIDER,
    models: [{ id: "fake", reasoning: false }],
    tokenSize: { min: 1, max: 1 },
  });
  const responses =
    mode === "tool"
      ? [
          fauxAssistantMessage(fauxText("AUTO NATIVE HISTORY RESPONSE")),
          fauxAssistantMessage(fauxToolCall("auto_compact_native_tool", {}), {
            stopReason: "toolUse",
          }),
          fauxAssistantMessage(fauxText("AUTO NATIVE CONTINUATION RESPONSE")),
        ]
      : mode === "failure"
        ? [
            fauxAssistantMessage(fauxText("AUTO FAILURE HISTORY RESPONSE")),
            fauxAssistantMessage([], {
              stopReason: "error",
              errorMessage: "AUTO FAILURE COMPACTION ERROR",
            }),
            fauxAssistantMessage(fauxText("AUTO FAILURE BACKOFF RESPONSE")),
            fauxAssistantMessage(fauxText("AUTO FAILURE RETRY RESPONSE")),
            fauxAssistantMessage(fauxText("AUTO FAILURE SUMMARY")),
          ]
        : mode === "queue"
          ? [
              fauxAssistantMessage(fauxText("AUTO NATIVE HISTORY RESPONSE")),
              fauxAssistantMessage(fauxText("AUTO NATIVE FINAL RESPONSE")),
              fauxAssistantMessage(fauxText("AUTO NATIVE QUEUED RESPONSE")),
            ]
          : [
              fauxAssistantMessage(fauxText("AUTO NATIVE HISTORY RESPONSE")),
              fauxAssistantMessage(fauxText("AUTO NATIVE FINAL RESPONSE")),
            ];
  faux.setResponses(
    responses.map((response) => (context: unknown) => {
      appendCapture(context);
      return response;
    }),
  );

  pi.registerProvider(PROVIDER, {
    name: "Auto Compact Native E2E",
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

  pi.registerTool({
    name: "auto_compact_native_tool",
    label: "Auto compact native tool",
    description: "Returns a non-terminating deterministic result.",
    parameters: Type.Object({}),
    async execute() {
      return {
        content: [
          { type: "text" as const, text: "AUTO NATIVE TOOL RESULT" },
        ],
        details: undefined,
      };
    },
  });
}
