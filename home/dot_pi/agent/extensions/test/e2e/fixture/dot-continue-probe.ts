import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "dot-continue-e2e";

type ResponseSpec = {
  text: string;
  error?: boolean;
  delayMs?: number;
};

function responseSpecs(): ResponseSpec[] {
  const raw = process.env.PI_E2E_DOT_RESPONSES;
  if (!raw) return [{ text: "DOT CONTINUE DEFAULT RESPONSE" }];
  const parsed = JSON.parse(raw) as unknown;
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (value) =>
        typeof value !== "object" ||
        value === null ||
        typeof (value as ResponseSpec).text !== "string",
    )
  ) {
    throw new Error("PI_E2E_DOT_RESPONSES must be an array of response specs");
  }
  return parsed as ResponseSpec[];
}

function appendCapture(context: unknown): void {
  const path = process.env.PI_E2E_DOT_CAPTURE;
  if (!path) return;
  const captures = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : [];
  captures.push(context);
  writeFileSync(path, JSON.stringify(captures, null, 2));
}

export default function dotContinueProbe(pi: ExtensionAPI): void {
  const faux = registerFauxProvider({
    provider: PROVIDER,
    models: [{ id: "fake", reasoning: false }],
  });
  faux.setResponses(
    responseSpecs().map((spec) => async (context: unknown) => {
      appendCapture(context);
      if (spec.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, spec.delayMs));
      }
      return spec.error
        ? fauxAssistantMessage([], {
            stopReason: "error",
            errorMessage: spec.text,
          })
        : fauxAssistantMessage(fauxText(spec.text));
    }),
  );

  pi.registerProvider(PROVIDER, {
    name: "Dot Continue E2E",
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

  pi.registerCommand("dot-label-leaf", {
    handler: async (_args, context) => {
      const manager = context.sessionManager as any;
      const leafId = manager.getLeafId?.();
      if (!leafId || typeof manager.appendLabelChange !== "function") {
        context.ui.notify("DOT LABEL FAILED", "error");
        return;
      }
      manager.appendLabelChange(leafId, "DOT_ERROR_LABEL");
      context.ui.notify(`DOT LABELLED ${leafId}`, "info");
    },
  });

  pi.on("session_start", (_event, context) => {
    if (context.mode === "tui") {
      context.ui.setWidget("dot-continue-probe", ["DOT CONTINUE PROBE READY"]);
    }
  });
}
