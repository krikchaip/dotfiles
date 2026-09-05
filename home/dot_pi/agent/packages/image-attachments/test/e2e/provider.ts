import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function imageAttachmentsE2eProvider(pi: ExtensionAPI): void {
  const baseUrl = process.env.IMAGE_ATTACHMENTS_E2E_URL;
  if (!baseUrl) throw new Error("IMAGE_ATTACHMENTS_E2E_URL is required.");

  pi.registerProvider("image-attachments-e2e", {
    name: "Image Attachments E2E",
    baseUrl,
    apiKey: "test",
    api: "openai-completions",
    models: [
      {
        id: "vision",
        name: "Vision Fixture",
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8_192,
        maxTokens: 256,
      },
      {
        id: "gpt-vision",
        name: "Restart Vision Fixture",
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8_192,
        maxTokens: 256,
      },
      {
        id: "text-only",
        name: "Text-only Fixture",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8_192,
        maxTokens: 256,
      },
    ],
  });
}
