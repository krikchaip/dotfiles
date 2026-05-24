/**
 * Custom LLM Error UI box
 *
 * Strategy:
 * - ALL errors: suppress red text in message_end by injecting a harmless
 *   toolCall content item, making hasToolCalls=true so
 *   AssistantMessageComponent skips the error rendering block.
 * - Keep stopReason="error" and errorMessage intact — Pi's retry
 *   mechanism (stopReason check, _retryAttempt counter) works unchanged.
 * - agent_end: remove the suppression toolCall from content, restore
 *   history cleanliness.
 *
 * Simple: no counters, timers, retry-tracking, or stopReason tricks.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Spacer, Text } from "@earendil-works/pi-tui";

const SUPPRESS_ID = "__llm_err_suppress__";

export default function (pi: ExtensionAPI) {
  const expandKeyHint = getExpandKeyHint();

  // ── message_end ──────────────────────────────────────────────────
  // Inject fake toolCall to suppress red text. Send custom card.
  // Keep stopReason="error" + original errorMessage intact so Pi's
  // retry mechanism and _retryAttempt counter work correctly.
  pi.on("message_end", async (event: any) => {
    const message = event.message;
    if (message.role !== "assistant" || message.stopReason !== "error") return;

    const errorMsg = message.errorMessage || "";
    const parsed = parseJsonOrString(errorMsg);
    const summary = extractSummary(errorMsg, parsed);

    pi.sendMessage({
      customType: "llm-error-card",
      content: summary,
      display: true,
      details: parsed,
    });

    // Inject a fake toolCall so hasToolCalls=true → error block skipped.
    // toolCall type isn't rendered by AssistantMessageComponent
    // (only text/thinking types render there). Cleaned up in agent_end.
    const content = [...(message.content || [])];
    content.push({
      type: "toolCall",
      id: SUPPRESS_ID,
      name: "__suppress__",
      arguments: "{}",
    });

    return {
      message: {
        ...message,
        content,
      },
    };
  });

  // ── agent_end ────────────────────────────────────────────────────
  // Remove the suppression toolCall from content so rebuilds don't
  // create ghost ToolExecutionComponents.
  pi.on("agent_end", async (event: any) => {
    const lastMsg = event.messages[event.messages.length - 1];
    if (lastMsg?.role === "assistant" && lastMsg.content) {
      lastMsg.content = lastMsg.content.filter(
        (c: any) => c.id !== SUPPRESS_ID,
      );
    }
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
