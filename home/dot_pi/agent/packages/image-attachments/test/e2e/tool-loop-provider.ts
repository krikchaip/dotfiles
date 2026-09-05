import {
  Type,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const providerName = "image-tool-loop-e2e";

export default function imageToolLoopProvider(pi: ExtensionAPI): void {
  const capturePath = process.env.IMAGE_TOOL_LOOP_CAPTURE;
  if (!capturePath) throw new Error("IMAGE_TOOL_LOOP_CAPTURE is required.");

  const append = (context: unknown): void => {
    const captures = existsSync(capturePath)
      ? JSON.parse(readFileSync(capturePath, "utf8"))
      : [];
    captures.push(context);
    writeFileSync(capturePath, JSON.stringify(captures, null, 2));
  };

  const faux = registerFauxProvider({
    provider: providerName,
    models: [{ id: "vision", reasoning: false }],
  });
  faux.setResponses([
    (context: unknown) => {
      append(context);
      return fauxAssistantMessage(fauxToolCall("image_e2e_tool", {}));
    },
    (context: unknown) => {
      append(context);
      return fauxAssistantMessage(fauxText("IMAGE_TOOL_LOOP_DONE"));
    },
  ]);

  pi.registerProvider(providerName, {
    name: "Image Tool Loop E2E",
    baseUrl: `faux://${providerName}`,
    apiKey: "test",
    api: faux.api,
    models: [
      {
        id: "vision",
        name: "Vision",
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8_192,
        maxTokens: 256,
      },
    ],
  });

  pi.registerTool({
    name: "image_e2e_tool",
    label: "Image E2E tool",
    description: "Returns deterministic text for image attachment E2E.",
    parameters: Type.Object({}),
    async execute() {
      return {
        content: [{ type: "text" as const, text: "IMAGE_TOOL_RESULT" }],
        details: undefined,
      };
    },
  });
}
