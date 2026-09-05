import {
  Type,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Image, setCapabilities } from "@earendil-works/pi-tui";

const PROVIDER = "safe-terminal-e2e";
const ESC = "\x1b";

export const MALICIOUS_TOOL_OUTPUT = [
  "SAFE_HEAD\tCOL2\rCR\bBS",
  `${ESC}[2JERASE_MARK`,
  `${ESC}]0;TITLE_ATTACK\x07TITLE_MARK`,
  `${ESC}]2;ST_TITLE_ATTACK${ESC}\\ST_TITLE_MARK`,
  `${ESC}P1;2|DCS_ATTACK${ESC}\\DCS_MARK`,
  `${ESC}XSOS_ATTACK${ESC}\\SOS_MARK`,
  `${ESC}^PM_ATTACK${ESC}\\PM_MARK`,
  `${ESC}_APC_ATTACK${ESC}\\APC_MARK`,
  `${ESC}[41mBG_ATTACK${ESC}[31mFG_SAFE${ESC}[0m`,
  `${ESC}[48;2;1;2;3mRGB_BG_ATTACK${ESC}[38;2;4;5;6mRGB_FG_SAFE${ESC}[0m`,
  `\x9b2JC1_MARK`,
  `${ESC}]8;;https://example.test\x07LINK${ESC}]8;;\x07`,
].join("");

export default function safeTerminalProvider(pi: ExtensionAPI): void {
  const capturePath = process.env.PI_E2E_SAFE_TERMINAL_CAPTURE;
  if (!capturePath) throw new Error("PI_E2E_SAFE_TERMINAL_CAPTURE is required.");

  const faux = registerFauxProvider({
    provider: PROVIDER,
    models: [{ id: "fake", reasoning: false }],
  });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("unsafe_terminal_output", {})),
    (context: unknown) => {
      writeFileSync(capturePath, JSON.stringify(context, null, 2));
      return fauxAssistantMessage(fauxText("SAFE_TERMINAL_DONE"));
    },
    fauxAssistantMessage(fauxToolCall("unsafe_terminal_output", {})),
    (context: unknown) => {
      writeFileSync(capturePath, JSON.stringify(context, null, 2));
      return fauxAssistantMessage(fauxText("SAFE_TERMINAL_RELOAD_DONE"));
    },
  ]);

  pi.registerProvider(PROVIDER, {
    name: "Safe Terminal E2E",
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
    name: "unsafe_terminal_output",
    label: "Unsafe terminal output",
    description: "Returns terminal control sequences for an isolated E2E test.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, onUpdate) {
      onUpdate?.({
        content: [
          {
            type: "text" as const,
            text: `${ESC}[2JSTREAM_ERASE_MARK${ESC}]0;STREAM_TITLE_ATTACK\x07STREAM_TITLE_MARK`,
          },
        ],
        details: undefined,
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      return {
        content: [{ type: "text" as const, text: MALICIOUS_TOOL_OUTPUT }],
        details: undefined,
      };
    },
  });

  pi.on("session_start", (_event, context) => {
    if (process.env.PI_E2E_SAFE_TERMINAL_IMAGE !== "1") return;
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    context.ui.setWidget("safe-terminal-image", () =>
      new Image(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "image/png",
        { fallbackColor: (text) => text },
        { imageId: 4242, maxWidthCells: 1, maxHeightCells: 1 },
        { widthPx: 1, heightPx: 1 },
      ),
    );
  });
}
