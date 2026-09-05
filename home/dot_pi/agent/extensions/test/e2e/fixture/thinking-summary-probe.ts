import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  AssistantMessageComponent,
  getMarkdownTheme,
  type ExtensionAPI,
  type MarkdownTransformer,
} from "@earendil-works/pi-coding-agent";

const stripAnsi = (value: string) =>
  value.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, "");

function message(
  content: unknown[],
  stopReason: "stop" | "length" | "aborted" | "error" = "stop",
  errorMessage?: string,
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "thinking-summary-e2e",
    model: "fake",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: Date.now(),
  } as AssistantMessage;
}

export default function thinkingSummaryProbe(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, context) => {
    const first = message([
      { type: "thinking", thinking: "# First concise summary\nprivate first detail" },
      { type: "text", text: "VISIBLE ANSWER BETWEEN" },
      { type: "toolCall", id: "tool-1", name: "read", arguments: { path: "x" } },
      { type: "thinking", thinking: "**Late separate summary**\nprivate late detail" },
      { type: "text", text: "VISIBLE ANSWER AFTER" },
    ]);
    const updated = message([
      { type: "thinking", thinking: "Updated streaming summary\nstale detail" },
      { type: "text", text: "UPDATED ANSWER" },
    ]);

    const transformers: MarkdownTransformer[] = [
      () => {
        throw new Error("EXPECTED TRANSFORMER FAILURE");
      },
      (markdown, transformContext) =>
        `${markdown}\nTRANSFORMED ${transformContext.messageType} ${String(transformContext.isStreaming)}`,
    ];
    const hidden = new AssistantMessageComponent(
      first,
      true,
      getMarkdownTheme(),
      "Thinking…",
      0,
      transformers,
    );
    const hiddenFirst = hidden.render(78).map(stripAnsi);
    hidden.updateContent(updated, true);
    const hiddenUpdated = hidden.render(78).map(stripAnsi);

    const expanded = new AssistantMessageComponent(
      first,
      false,
      getMarkdownTheme(),
      "Thinking…",
      0,
    );
    const expandedLines = expanded.render(78).map(stripAnsi);

    const stopReasons = {
      length: new AssistantMessageComponent(
        message([{ type: "thinking", thinking: "Length summary\nprivate" }], "length"),
        true,
        getMarkdownTheme(),
      ).render(78).map(stripAnsi),
      aborted: new AssistantMessageComponent(
        message([{ type: "thinking", thinking: "Abort summary\nprivate" }], "aborted", "CUSTOM ABORT"),
        true,
        getMarkdownTheme(),
      ).render(78).map(stripAnsi),
      defaultAborted: new AssistantMessageComponent(
        message([{ type: "thinking", thinking: "Default abort summary\nprivate" }], "aborted", "Request was aborted"),
        true,
        getMarkdownTheme(),
      ).render(78).map(stripAnsi),
      error: new AssistantMessageComponent(
        message([{ type: "thinking", thinking: "Error summary\nprivate" }], "error", "PROBE ERROR"),
        true,
        getMarkdownTheme(),
      ).render(78).map(stripAnsi),
    };

    const path = process.env.PI_E2E_THINKING_SUMMARY_CAPTURE;
    if (!path) throw new Error("PI_E2E_THINKING_SUMMARY_CAPTURE is required");
    const previous = existsSync(path)
      ? (JSON.parse(readFileSync(path, "utf8")) as { sessionStarts?: number })
      : {};
    writeFileSync(path, JSON.stringify({
      hiddenFirst,
      hiddenUpdated,
      expandedLines,
      stopReasons,
      sessionStarts: (previous.sessionStarts ?? 0) + 1,
    }));
    context.ui.setWidget("thinking-summary-probe", ["THINKING SUMMARY PROBE READY"]);
  });
}
