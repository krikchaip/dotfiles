import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const text = "hé🙂";
export const imageUrl = "data:image/png;base64,AQID";
export const toolText = "tool ✓";
export const toolJson = { ok: "✓" };
export const assistantTexts = ["answer ✓", "second"];
export const functionArguments = '{"city":"กรุงเทพ"}';

export const shapeInput = [
  7,
  { role: "developer", content: [{ type: "input_text", text: "policy" }] },
  {},
  {
    role: "user",
    content: [
      { type: "input_text", text },
      { type: "input_image", image_url: imageUrl },
    ],
  },
  { type: "function_call_output", output: toolText },
  { type: "function_call_output", output: toolJson },
  {
    type: "message",
    content: assistantTexts.map((value) => ({
      type: "output_text",
      text: value,
    })),
  },
  { type: "function_call", arguments: functionArguments },
  { type: "reasoning", summary: [{ type: "summary_text", text: "why" }] },
];

export default function installPayloadMutator(pi: ExtensionAPI): void {
  pi.on("before_provider_request", (event) => {
    const payload = event.payload as Record<string, unknown>;
    payload.input = shapeInput;
    payload.messages = [
      { role: "system", content: "rules" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
      { type: "tool", content: { ok: true } },
      42,
    ];
    payload.nested = { preview: "data:image/webp;base64,BAUG" };
  });
}
