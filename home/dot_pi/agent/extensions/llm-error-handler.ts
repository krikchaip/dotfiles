/**
 * Custom LLM Error Handler Extension
 *
 * Suppresses default raw red LLM API error outputs in the TUI,
 * replacing them with a beautifully formatted block/card.
 * Hides the full JSON details by default, allowing toggle expansion with the user's active keybinding.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Box, Spacer, Text } from "@earendil-works/pi-tui";

// Helper to dynamically resolve the keybinding for expanding tool outputs
function getExpandKeyHint(): string {
  const defaultKey = "Ctrl+O";
  try {
    const keybindingsPath = join(homedir(), ".pi", "agent", "keybindings.json");
    if (!existsSync(keybindingsPath)) {
      return defaultKey;
    }
    const content = readFileSync(keybindingsPath, "utf8");
    const config = JSON.parse(content);

    const bindings = config["app.tools.expand"];
    if (!bindings) {
      return defaultKey;
    }

    const rawKey = Array.isArray(bindings) ? bindings[0] : bindings;
    if (typeof rawKey === "string" && rawKey.trim()) {
      return rawKey
        .trim()
        .split("+")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("+");
    }
  } catch (err) {
    // Fall back to default silently
  }
  return defaultKey;
}

export default function (pi: ExtensionAPI) {
  // Resolve the keybinding dynamic hint once on startup
  const expandKeyHint = getExpandKeyHint();

  // Register custom renderer for "llm-error-card"
  pi.registerMessageRenderer(
    "llm-error-card",
    (message, { expanded }, theme) => {
      // Render as a beautiful Box block with a subtle toolErrorBg or customMessageBg
      const box = new Box(1, 1, (t) => theme.bg("toolErrorBg", t));

      // Warn header in the theme's warning color (softer yellow/orange instead of bright red)
      const header = theme.bold(
        theme.fg("warning", "⚠️ LLM API Error Encountered"),
      );
      box.addChild(new Text(header, 0, 0));
      box.addChild(new Spacer(1));

      // Clean summary of the error
      const summary =
        typeof message.content === "string"
          ? message.content
          : "An unexpected LLM API error occurred.";
      box.addChild(new Text(theme.fg("text", summary), 0, 0));

      // Show details if expanded (Alt+J / Ctrl+O)
      if (expanded && message.details) {
        box.addChild(new Spacer(1));
        box.addChild(
          new Text(theme.fg("dim", "--- Raw JSON Response ---"), 0, 0),
        );

        const jsonStr =
          typeof message.details === "string"
            ? message.details
            : JSON.stringify(message.details, null, 2);

        box.addChild(new Spacer(1));
        box.addChild(new Text(theme.fg("dim", jsonStr), 0, 0));
      } else if (message.details) {
        box.addChild(new Spacer(1));
        box.addChild(
          new Text(
            theme.fg(
              "dim",
              `💡 Press ${expandKeyHint} to expand full JSON details`,
            ),
            0,
            0,
          ),
        );
      }

      return box;
    },
  );

  // Intercept assistant messages that fail with stopReason = "error"
  pi.on("message_end", async (event, ctx: ExtensionContext) => {
    const message = event.message;
    if (message.role !== "assistant" || message.stopReason !== "error") return;

    // Retrieve retry settings dynamically from the runtime session
    const session = (ctx as any).session;
    const settings = session?.settingsManager?.getRetrySettings();
    const retryEnabled = settings?.enabled ?? true;
    const maxRetries = settings?.maxRetries ?? 5;
    const currentAttempt = session?.retryAttempt ?? 0;

    // Regex to match Pi's retryable transient errors
    const isRetryable =
      /overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|websocket.?closed|websocket.?error|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|stream ended before message_stop|http2 request did not get a response|timed? out|timeout|terminated|retry delay/i.test(
        message.errorMessage || "",
      );

    const willRetry =
      retryEnabled && isRetryable && currentAttempt < maxRetries;

    if (willRetry) {
      // Let the default auto-retry and countdown spinner handle it
      return;
    }

    // Suppress the default bright red assistant error block
    // by changing stopReason to "stop" and clearing the errorMessage.
    const errorMessage = message.errorMessage || "Unknown error";

    // Build a short human-readable summary; keep the full error in details
    const parsed = parseJsonOrString(errorMessage);
    const summary = extractSummary(errorMessage, parsed);

    // Send a beautifully styled custom "llm-error-card" message in its place
    pi.sendMessage({
      customType: "llm-error-card",
      content: summary,
      display: true,
      details: parsed,
    });

    return {
      message: {
        ...message,
        stopReason: "stop",
        errorMessage: undefined,
      },
    };
  });
}

function parseJsonOrString(str: string) {
  // Strip a leading HTTP status code (e.g. "400 {...}") before parsing
  const jsonStart = str.indexOf("{");
  const jsonPart = jsonStart !== -1 ? str.slice(jsonStart) : str;
  try {
    return JSON.parse(jsonPart);
  } catch {
    return str;
  }
}

function extractSummary(raw: string, parsed: unknown): string {
  // Try to pull a short message from the parsed JSON body
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, any>;
    // Gemini / Google style: { error: { code, message, status } }
    if (obj.error?.message) {
      const code = obj.error.status ?? obj.error.code ?? "";
      return code ? `${code}: ${obj.error.message}` : obj.error.message;
    }
    // Anthropic style: { type, error: { type, message } }
    if (obj.type === "error" && obj.error?.message) {
      return `${obj.error.type ?? "error"}: ${obj.error.message}`;
    }
    // OpenAI style: { error: { message, type, code } }
    if (obj.error?.message) {
      return obj.error.message;
    }
    // Generic top-level message field
    if (typeof obj.message === "string") {
      return obj.message;
    }
  }
  // Fall back: strip leading HTTP status number if present, return plain text
  return raw.replace(/^\d{3}\s+/, "").slice(0, 200);
}
