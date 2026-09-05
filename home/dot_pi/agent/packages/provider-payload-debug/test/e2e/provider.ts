import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function installProviderPayloadDebugE2eProvider(
	pi: ExtensionAPI,
): void {
	const baseUrl = process.env.PROVIDER_PAYLOAD_DEBUG_E2E_URL;
	if (!baseUrl) throw new Error("PROVIDER_PAYLOAD_DEBUG_E2E_URL is required.");

	pi.registerProvider("provider-payload-debug-e2e", {
		name: "Provider Payload Debug E2E",
		baseUrl,
		apiKey: "test",
		api: "openai-completions",
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
