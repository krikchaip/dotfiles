import { appendFileSync } from "node:fs";
import {
  InteractiveMode,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

type StatusIndicator = {
  kind?: string;
  render?: (width: number) => string[];
};

type StatusOwner = {
  showStatusIndicator(indicator: StatusIndicator): void;
  clearStatusIndicator(kind?: string): void;
};

function captureRenameStatus(): void {
  const path = process.env.PI_E2E_RENAME_STATUS_CAPTURE;
  if (!path) return;
  const prototype = InteractiveMode.prototype as unknown as StatusOwner;
  const originalShow = prototype.showStatusIndicator;
  const originalClear = prototype.clearStatusIndicator;
  prototype.showStatusIndicator = function (indicator) {
    let rendered: string[] = [];
    try {
      rendered = indicator.render?.(120) ?? [];
    } catch {
      rendered = [];
    }
    appendFileSync(
      path,
      `${JSON.stringify({ action: "show", kind: indicator.kind, rendered })}\n`,
    );
    return originalShow.call(this, indicator);
  };
  prototype.clearStatusIndicator = function (kind) {
    appendFileSync(path, `${JSON.stringify({ action: "clear", kind })}\n`);
    return originalClear.call(this, kind);
  };
}

export default function generatedStateProbe(pi: ExtensionAPI): void {
  captureRenameStatus();

  pi.registerCommand("e2e-compact", {
    description: "Compact through the real session API",
    handler: async (_args, context) => {
      await new Promise<void>((resolve) => {
        context.compact({
          customInstructions: "FOCUS ON COMPACTION REGRESSION",
          onComplete: () => {
            context.ui.notify("E2E COMPACT COMPLETE", "info");
            resolve();
          },
          onError: (error) => {
            context.ui.notify(`E2E COMPACT ERROR ${error.message}`, "error");
            resolve();
          },
        });
      });
    },
  });

  pi.registerCommand("e2e-branch-summary", {
    description: "Generate a branch summary through the real session tree API",
    handler: async (_args, context) => {
      const target = context.sessionManager
        .getBranch()
        .find(
          (entry) =>
            entry.type === "message" && entry.message.role === "assistant",
        );
      if (!target) {
        context.ui.notify("E2E BRANCH SUMMARY NO TARGET", "error");
        return;
      }
      const result = await context.navigateTree(target.id, {
        summarize: true,
        customInstructions: "FOCUS ON BRANCH REGRESSION",
        replaceInstructions: false,
        label: "E2E branch summary",
      });
      context.ui.notify(
        result.cancelled
          ? "E2E BRANCH SUMMARY CANCELLED"
          : `E2E BRANCH SUMMARY COMPLETE ${target.id}`,
        result.cancelled ? "warning" : "info",
      );
    },
  });
}
