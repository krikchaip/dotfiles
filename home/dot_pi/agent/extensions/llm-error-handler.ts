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
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Spacer, Text } from "@earendil-works/pi-tui";

// Helper to dynamically resolve the keybinding for expanding tool outputs
function getExpandKeyHint(): string {
  const defaultKey = "ctrl+o";

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
        .join("+")
        .toLowerCase();
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

      // Header + status code + expand hint all on same line
      const summary =
        typeof message.content === "string" && message.content
          ? message.content
          : "Unknown error";
      const expandHint =
        !expanded && message.details
          ? " " + theme.fg("dim", `(${expandKeyHint} to expand)`)
          : "";
      const header =
        theme.bold(theme.fg("warning", "⚠️ LLM API Error")) +
        " " +
        theme.fg("text", summary) +
        expandHint;
      box.addChild(new Text(header, 0, 0));

      // Show full JSON only when expanded
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
      }

      return box;
    },
  );

  // Intercept assistant messages that fail with stopReason = "error"
  pi.on("message_end", async (event) => {
    const message = event.message;
    if (message.role !== "assistant" || message.stopReason !== "error") return;

    // By the time message_end fires, pi has already exhausted its auto-retry.
    // Format all errors with the custom card.
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

    // Keep stopReason as "error" so pi doesn't retry.
    // Clear errorMessage to suppress the default red raw text.
    return {
      message: {
        ...message,
        errorMessage: "",
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
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, any>;
    const err = obj.error ?? obj;
    const code = err.code ?? "";
    const status = err.status ?? err.type ?? "";

    if (code || status) {
      return `${[code, status].filter(Boolean).join(" ")}`;
    }
  }

  // Fall back: grab leading HTTP status code from raw string
  const match = raw.match(/^(\d{3})/);
  return match ? `${match[1]}` : "";
}
