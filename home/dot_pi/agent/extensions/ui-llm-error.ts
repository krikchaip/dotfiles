/**
 * Custom LLM Error UI box
 *
 * Strategy (Approach A):
 * - Retryable errors (503, 429, timeout, etc.): let Pi's native UI handle
 *   (red text → retry countdown → red text if exhausted). No interference.
 * - Non-retryable errors (auth, bad model, etc.): suppress native red text,
 *   render custom llm-error-card instead.
 *
 * How suppression works:
 *   message_end: change stopReason from "error" to "stop" so that
 *   AssistantMessageComponent skips the error rendering block entirely.
 *   agent_end: restore stopReason and errorMessage before Pi's retry check
 *   runs (same object ref → propagates to _lastAssistantMessage).
 *
 * No session pollution: we don't inject fake content (like toolCall) into
 * the message, so rebuilds and LLM context stay clean.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Spacer, Text } from "@earendil-works/pi-tui";

// Pi's internal retry regex from agent-session.js _isRetryableError (line 1942)
const RETRYABLE_REGEX =
  /overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|websocket.?closed|websocket.?error|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|stream ended before message_stop|http2 request did not get a response|timed? out|timeout|terminated|retry delay/i;

export default function (pi: ExtensionAPI) {
  const expandKeyHint = getExpandKeyHint();

  // Saved original errorMessage so we can restore it in agent_end
  // for Pi's retry check (_willRetryAfterAgentEnd / _handlePostAgentRun).
  let savedErrorMessage: string | null = null;

  // ── message_end ──────────────────────────────────────────────────
  // Runs BEFORE TUI renders. We mutate the message to suppress red text
  // for non-retryable errors.
  pi.on("message_end", async (event: any) => {
    const message = event.message;
    if (message.role !== "assistant" || message.stopReason !== "error") return;

    const errorMsg = message.errorMessage || "";

    // Approach A: retryable errors → let Pi's native UI handle
    if (RETRYABLE_REGEX.test(errorMsg)) return;

    // Non-retryable: swap stopReason so AssistantMessageComponent skips
    // the error rendering block. We restore this in agent_end.
    savedErrorMessage = errorMsg;

    return {
      message: {
        ...message,
        stopReason: "stop",
        errorMessage: "",
      },
    };
  });

  // ── agent_end ────────────────────────────────────────────────────
  // Runs AFTER TUI render, BEFORE _willRetryAfterAgentEnd.
  // Restore original error data, then decide whether to show card.
  pi.on("agent_end", async (event: any) => {
    const lastMsg = event.messages[event.messages.length - 1];
    if (lastMsg?.role !== "assistant") {
      savedErrorMessage = null;
      return;
    }

    // Restore error data if we suppressed it in message_end
    if (savedErrorMessage !== null && lastMsg.stopReason !== "error") {
      lastMsg.stopReason = "error";
      lastMsg.errorMessage = savedErrorMessage;
    }

    const rawError = lastMsg.errorMessage || "";
    savedErrorMessage = null;

    // Retryable → let Pi's retry countdown handle
    if (lastMsg.stopReason !== "error" || RETRYABLE_REGEX.test(rawError))
      return;

    // Non-retryable → render custom card
    const parsed = parseJsonOrString(rawError);
    const summary = extractSummary(rawError, parsed);

    pi.sendMessage({
      customType: "llm-error-card",
      content: summary,
      display: true,
      details: parsed,
    });
  });

  // ── Custom card renderer ─────────────────────────────────────────
  pi.registerMessageRenderer(
    "llm-error-card",
    (message: any, { expanded }: any, theme: any) => {
      const box = new Box(1, 1, (t: string) => theme.bg("toolErrorBg", t));

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
}

// ── Helpers ────────────────────────────────────────────────────────

let cachedExpandKeyHint: string | undefined;

function getExpandKeyHint(): string {
  if (cachedExpandKeyHint !== undefined) return cachedExpandKeyHint;

  const defaultKey = "ctrl+o";

  try {
    const keybindingsPath = join(homedir(), ".pi", "agent", "keybindings.json");

    if (!existsSync(keybindingsPath)) {
      cachedExpandKeyHint = defaultKey;
      return defaultKey;
    }

    const content = readFileSync(keybindingsPath, "utf8");
    const config = JSON.parse(content);

    const bindings = config["app.tools.expand"];
    if (!bindings) {
      cachedExpandKeyHint = defaultKey;
      return defaultKey;
    }

    const rawKey = Array.isArray(bindings) ? bindings[0] : bindings;
    if (typeof rawKey === "string" && rawKey.trim()) {
      cachedExpandKeyHint = rawKey.trim().toLowerCase();
      return cachedExpandKeyHint;
    }
  } catch {
    // Fall back silently
  }

  cachedExpandKeyHint = defaultKey;
  return defaultKey;
}

function parseJsonOrString(str: string): unknown {
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

  const match = raw.match(/^(\d{3})/);
  return match ? `${match[1]}` : "";
}
