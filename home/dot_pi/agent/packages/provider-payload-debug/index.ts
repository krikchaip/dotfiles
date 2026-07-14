/**
 * Provider payload debug extension for Pi.
 *
 * Captures read-only snapshots of final provider request payloads and response
 * metadata under ~/.pi/agent/debug/provider-payloads for payload-size debugging.
 * Keep this loaded last so the captured payload includes upstream extension
 * mutations.
 *
 * Usage:
 *   /provider-payload-debug              Show help and current status.
 *   /provider-payload-debug on|off|once  Set capture mode.
 *   /provider-payload-debug <prompt>     Capture only this prompt, then turn off.
 *   --provider-payload-debug             Start session with capture on.
 *   Ctrl+Alt+D                           Toggle capture on/off.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";

type CaptureMode = "off" | "on" | "once";

type CaptureRecord = {
  requestId: string;
  sessionDir: string;
  requestDir: string;
  payloadFile: string;
  summaryFile: string;
  responseFile: string;
};

type Counter = { count: number; bytes: number };

const DEBUG_DIR = join(homedir(), ".pi", "agent", "debug", "provider-payloads");
const FLAG_NAME = "provider-payload-debug";
const TOGGLE_KEY: KeyId = "ctrl+alt+d";

let mode: CaptureMode = "off";
let sequence = 0;
let lastCapture: CaptureRecord | undefined;

function jsonBytes(value: unknown): number {
  const json = JSON.stringify(value);
  return typeof json === "string" ? Buffer.byteLength(json) : 0;
}

function stringBytes(value: unknown): number {
  return typeof value === "string" ? Buffer.byteLength(value) : 0;
}

function addCounter(map: Record<string, Counter>, key: string, bytes: number) {
  const current = map[key] ?? { count: 0, bytes: 0 };
  current.count += 1;
  current.bytes += bytes;
  map[key] = current;
}

function sanitizeFilePart(value: unknown): string {
  const raw = String(value ?? "unknown");
  return (
    raw
      .replace(/[^a-zA-Z0-9_.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "unknown"
  );
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function nowFileStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function payloadModel(payload: any, ctx: any): string {
  const model = payload?.model ?? ctx.model?.id;
  const provider = ctx.model?.provider;
  return provider ? `${provider}-${model}` : String(model ?? "unknown-model");
}

function sessionDirName(ctx: any): string {
  const sessionId = ctx.sessionManager?.getSessionId?.();
  if (sessionId) return sanitizeFilePart(sessionId);

  const sessionFile = ctx.sessionManager?.getSessionFile?.();
  if (sessionFile)
    return sanitizeFilePart(basename(sessionFile).replace(/\.jsonl$/, ""));

  return `no-session_${shortHash(ctx.cwd ?? "")}`;
}

function summarizeTopLevel(payload: any): Record<string, Counter> {
  const totals: Record<string, Counter> = {};
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return totals;

  for (const [key, value] of Object.entries(payload)) {
    addCounter(totals, key, jsonBytes(value));
  }
  return totals;
}

function summarizeOpenAIInput(input: unknown): {
  itemTotals: Record<string, Counter>;
  payloadFields: Record<string, Counter>;
} {
  const itemTotals: Record<string, Counter> = {};
  const payloadFields: Record<string, Counter> = {};
  if (!Array.isArray(input)) return { itemTotals, payloadFields };

  for (const item of input) {
    if (!item || typeof item !== "object") {
      addCounter(itemTotals, "input:primitive", jsonBytes(item));
      continue;
    }

    const message = item as any;
    const kind =
      message.type ?? (message.role ? `role:${message.role}` : "unknown");
    const itemKey = message.role === "user" ? "user_message" : String(kind);
    addCounter(itemTotals, itemKey, jsonBytes(message));

    if (message.role === "user" && Array.isArray(message.content)) {
      for (const part of message.content) {
        const partType = part?.type ?? "unknown";
        addCounter(itemTotals, `user_part:${partType}`, jsonBytes(part));
        if (partType === "input_image") {
          addCounter(
            payloadFields,
            "user_image_url_chars",
            stringBytes(part?.image_url),
          );
        }
        if (partType === "input_text") {
          addCounter(
            payloadFields,
            "user_input_text_chars",
            stringBytes(part?.text),
          );
        }
      }
    }

    if (message.type === "function_call_output") {
      if (typeof message.output === "string") {
        addCounter(
          payloadFields,
          "tool_output_text_chars",
          stringBytes(message.output),
        );
      } else {
        addCounter(
          payloadFields,
          "tool_output_json_chars",
          jsonBytes(message.output),
        );
      }
    }

    if (message.type === "message") {
      const text = message.content?.[0]?.text;
      addCounter(
        payloadFields,
        "assistant_output_text_chars",
        stringBytes(text),
      );
    }

    if (message.type === "function_call") {
      addCounter(
        payloadFields,
        "assistant_function_arguments_chars",
        stringBytes(message.arguments),
      );
    }

    if (message.type === "reasoning") {
      addCounter(
        payloadFields,
        "assistant_reasoning_item_json_chars",
        jsonBytes(message),
      );
    }
  }

  return { itemTotals, payloadFields };
}

function summarizeMessagesArray(messages: unknown): Record<string, Counter> {
  const totals: Record<string, Counter> = {};
  if (!Array.isArray(messages)) return totals;

  for (const message of messages) {
    if (!message || typeof message !== "object") {
      addCounter(totals, "message:primitive", jsonBytes(message));
      continue;
    }

    const item = message as any;
    const key = item.role
      ? `role:${item.role}`
      : item.type
        ? `type:${item.type}`
        : "unknown";
    addCounter(totals, key, jsonBytes(item));
  }
  return totals;
}

function collectImagePayloads(
  value: unknown,
): Array<{ path: string; bytes: number; chars: number; mimeType?: string }> {
  const images: Array<{
    path: string;
    bytes: number;
    chars: number;
    mimeType?: string;
  }> = [];
  const seen = new Set<unknown>();

  function walk(node: unknown, path: string) {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }

    for (const [key, child] of Object.entries(node)) {
      const childPath = path ? `${path}.${key}` : key;
      if (typeof child === "string" && child.startsWith("data:image/")) {
        const match = child.match(/^data:([^;,]+);base64,/);
        images.push({
          path: childPath,
          chars: child.length,
          bytes: Buffer.byteLength(child),
          mimeType: match?.[1],
        });
        continue;
      }
      walk(child, childPath);
    }
  }

  walk(value, "payload");
  return images;
}

function buildSummary(
  payload: unknown,
  ctx: any,
  requestId: string,
  files: CaptureRecord,
) {
  const openAI = summarizeOpenAIInput((payload as any)?.input);
  return {
    requestId,
    capturedAt: new Date().toISOString(),
    cwd: ctx.cwd,
    sessionId: ctx.sessionManager?.getSessionId?.(),
    sessionFile: ctx.sessionManager?.getSessionFile?.(),
    leafId: ctx.sessionManager?.getLeafId?.(),
    model: ctx.model
      ? { provider: ctx.model.provider, api: ctx.model.api, id: ctx.model.id }
      : undefined,
    files,
    totalPayloadBytes: jsonBytes(payload),
    topLevelFieldBytes: summarizeTopLevel(payload),
    openAIResponsesInput: {
      itemCount: Array.isArray((payload as any)?.input)
        ? (payload as any).input.length
        : 0,
      itemTotals: openAI.itemTotals,
      payloadFields: openAI.payloadFields,
    },
    messagesArrayTotals: summarizeMessagesArray((payload as any)?.messages),
    imagePayloads: collectImagePayloads(payload),
  };
}

function capturePayload(payload: unknown, ctx: any): CaptureRecord {
  const sessionDir = join(DEBUG_DIR, sessionDirName(ctx));

  sequence += 1;
  const requestId = `${nowFileStamp()}_${String(sequence).padStart(4, "0")}_${sanitizeFilePart(payloadModel(payload, ctx))}`;
  const requestDir = join(sessionDir, requestId);
  mkdirSync(requestDir, { recursive: true });

  const payloadFile = join(requestDir, "payload.json");
  const summaryFile = join(requestDir, "summary.json");
  const responseFile = join(requestDir, "response.json");
  const files = {
    requestId,
    sessionDir,
    requestDir,
    payloadFile,
    summaryFile,
    responseFile,
  };

  writeFileSync(payloadFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  writeFileSync(
    summaryFile,
    `${JSON.stringify(buildSummary(payload, ctx, requestId, files), null, 2)}\n`,
    "utf8",
  );

  lastCapture = files;
  return files;
}

function statusText(): string {
  const last = lastCapture ? `\nlast: ${lastCapture.summaryFile}` : "";
  return `provider-payload-debug: ${mode}${last}`;
}

function usageText(): string {
  return [
    "Usage:",
    "  /provider-payload-debug              Show help and current status.",
    "  /provider-payload-debug on|off|once  Set capture mode.",
    "  /provider-payload-debug <prompt>     Capture only this prompt, then turn off.",
    "  --provider-payload-debug             Start session with capture on.",
    `  ${TOGGLE_KEY}                           Toggle capture on/off.`,
    "",
    statusText(),
  ].join("\n");
}

function onceText(): string {
  const last = lastCapture ? `\nlast: ${lastCapture.summaryFile}` : "";
  return `provider-payload-debug: once\nNext provider request will be captured, then capture turns off.${last}`;
}

function toggleMode(): void {
  mode = mode === "on" ? "off" : "on";
}

export default function (pi: ExtensionAPI) {
  pi.registerFlag(FLAG_NAME, {
    description: "Start with provider payload debug capture enabled",
    type: "boolean",
    default: false,
  });

  pi.registerShortcut(TOGGLE_KEY, {
    description: "Toggle provider payload debug capture on/off",
    handler: async (ctx) => {
      toggleMode();
      ctx.ui.notify(statusText(), "info");
    },
  });

  pi.on("session_start", (_event, ctx) => {
    if (pi.getFlag(FLAG_NAME) !== true) return;

    mode = "on";
    ctx.ui.notify(statusText(), "info");
  });

  pi.registerCommand("provider-payload-debug", {
    description:
      "Capture final provider payloads to ~/.pi/agent/debug/provider-payloads",
    getArgumentCompletions: (prefix) => {
      const value = prefix.trim();
      if (/\s/.test(value)) return null;

      const items = [
        {
          value: "on",
          label: "on",
          description: "Capture every provider request",
        },
        {
          value: "off",
          label: "off",
          description: "Stop provider payload capture",
        },
        {
          value: "once",
          label: "once",
          description: "Capture next provider request only",
        },
      ].filter((item) => item.value.startsWith(value.toLowerCase()));
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      const prompt = args.trim();
      const action = prompt.toLowerCase();

      if (!prompt) {
        ctx.ui.notify(usageText(), "info");
        return;
      }

      if (action === "on" || action === "off") {
        mode = action;
        ctx.ui.notify(statusText(), "info");
        return;
      }

      if (action === "once") {
        mode = "once";
        ctx.ui.notify(onceText(), "info");
        return;
      }

      if (!ctx.isIdle()) {
        ctx.ui.notify(
          "provider-payload-debug: agent busy; send prompt when idle",
          "warning",
        );
        return;
      }

      mode = "once";
      ctx.ui.notify(
        "provider-payload-debug: capturing this prompt only; capture turns off after next provider request",
        "info",
      );
      pi.sendUserMessage(args);
    },
  });

  pi.on("before_provider_request", (event, ctx) => {
    if (mode === "off") return;

    const capture = capturePayload(event.payload, ctx as any);
    if (mode === "once") mode = "off";
    ctx.ui.notify(`Captured provider payload: ${capture.summaryFile}`, "info");
  });

  pi.on("after_provider_response", (event) => {
    if (!lastCapture) return;

    writeFileSync(
      lastCapture.responseFile,
      `${JSON.stringify({ requestId: lastCapture.requestId, capturedAt: new Date().toISOString(), status: event.status, headers: event.headers }, null, 2)}\n`,
      "utf8",
    );
  });
}
