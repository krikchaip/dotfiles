import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "extension-e2e";

function responses(): string[] {
  const raw = process.env.PI_E2E_RESPONSES;
  if (!raw) return ["E2E provider response"];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
    throw new Error("PI_E2E_RESPONSES must be a JSON array of strings.");
  }
  return parsed;
}

function appendCapture(context: unknown): void {
  const path = process.env.PI_E2E_PROVIDER_CAPTURE;
  if (!path) return;

  const captures = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : [];
  captures.push(context);
  writeFileSync(path, JSON.stringify(captures, null, 2));
}

export default function fauxProvider(pi: ExtensionAPI): void {
  const faux = registerFauxProvider({
    provider: PROVIDER,
    models: [{ id: "fake", reasoning: false }],
  });
  faux.setResponses(
    responses().map((text) => (context: unknown) => {
      appendCapture(context);
      return fauxAssistantMessage(fauxText(text));
    }),
  );

  pi.registerProvider(PROVIDER, {
    name: "Extension E2E",
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
