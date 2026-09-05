import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "generated-state-e2e";

function stringArray(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
    throw new Error(`${name} must be a JSON string array`);
  }
  return parsed;
}

function numberArray(name: string): number[] {
  const raw = process.env[name];
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "number")) {
    throw new Error(`${name} must be a JSON number array`);
  }
  return parsed;
}

function appendCapture(context: unknown): void {
  const path =
    process.env.PI_E2E_GENERATED_PROVIDER_CAPTURE ??
    process.env.PI_E2E_PROVIDER_CAPTURE;
  if (!path) return;
  const captures = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
  captures.push(context);
  writeFileSync(path, JSON.stringify(captures, null, 2));
}

export default function generatedStateProvider(pi: ExtensionAPI): void {
  const responses = process.env.PI_E2E_GENERATED_RESPONSES
    ? stringArray("PI_E2E_GENERATED_RESPONSES", [])
    : stringArray("PI_E2E_RESPONSES", ["GENERATED STATE RESPONSE"]);
  const delays = numberArray("PI_E2E_RESPONSE_DELAYS_MS");
  const errorIndexes = new Set(numberArray("PI_E2E_GENERATED_ERROR_INDEXES"));
  const abortIndexes = new Set(numberArray("PI_E2E_GENERATED_ABORT_INDEXES"));
  const setNameDuringIndex = Number(process.env.PI_E2E_GENERATED_SET_NAME_DURING_INDEX ?? "NaN");
  const setNameDuringValue = process.env.PI_E2E_GENERATED_SET_NAME_DURING_VALUE;
  const faux = registerFauxProvider({
    provider: PROVIDER,
    models: [{ id: "gemini-fake", reasoning: false }],
  });
  faux.setResponses(
    responses.map((text, index) => (context: unknown) => {
      appendCapture(context);
      const message = abortIndexes.has(index)
        ? fauxAssistantMessage([], {
            stopReason: "aborted",
            errorMessage: text,
          })
        : errorIndexes.has(index)
          ? fauxAssistantMessage([], {
              stopReason: "error",
              errorMessage: text,
            })
          : fauxAssistantMessage(fauxText(text));
      const delay = delays[index] ?? 0;
      if (index === setNameDuringIndex && setNameDuringValue) {
        setTimeout(() => pi.setSessionName(setNameDuringValue), Math.max(1, Math.floor(delay / 2)));
      }
      if (delay <= 0) return message;
      return new Promise((resolve) => setTimeout(resolve, delay)).then(
        () => message,
      );
    }),
  );
  const model = {
    id: "gemini-fake",
    name: "Gemini Fake",
    reasoning: false,
    input: ["text"] as ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8_192,
    maxTokens: 1_024,
  };
  pi.registerProvider(PROVIDER, {
    name: "Generated State E2E",
    baseUrl: `faux://${PROVIDER}`,
    apiKey: "test",
    api: faux.api,
    models: [model],
  });
  pi.registerProvider("generated-state-noauth", {
    name: "Generated State No Auth E2E",
    baseUrl: "faux://generated-state-noauth",
    apiKey: "$PI_E2E_INTENTIONALLY_MISSING_API_KEY",
    api: faux.api,
    models: [{ ...model, id: "gemini-noauth", name: "Gemini No Auth" }],
  });
}
