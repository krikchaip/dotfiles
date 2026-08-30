import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import type { ChildRuntime } from "./runtime.ts";

const COMMAND_NAME = "subagent-done";
const COMMAND_DESCRIPTION =
  "Prepare and deliver the final parent handoff for this subagent.";

/** Child-only slash commands and command completion. */
export class ChildCommands {
  /** Registers child-only command behavior for the child runtime lifecycle. */
  public static register(
    pi: ExtensionAPI,
    runtime: ChildRuntime,
  ): ChildCommands {
    return new ChildCommands(pi, runtime).install();
  }

  private constructor(
    private readonly pi: ExtensionAPI,
    private readonly runtime: ChildRuntime,
  ) {}

  /** Registers completion for human use in every child lifecycle. */
  private install(): ChildCommands {
    this.pi.registerCommand(COMMAND_NAME, {
      description: COMMAND_DESCRIPTION,
      handler: async (args, context) => {
        if (args.trim()) {
          context.ui.notify(`Usage: /${COMMAND_NAME}`, "warning");
          return;
        }

        if (this.runtime.isActive()) {
          context.ui.notify(
            "Wait for the current turn or interrupt it first.",
            "warning",
          );
          return;
        }

        try {
          await this.runtime.startCompletionTurn();
        } catch (cause) {
          context.ui.notify(
            cause instanceof Error ? cause.message : String(cause),
            "error",
          );
        }
      },
    });

    this.pi.on("session_start", (_event, context) => {
      this.installAutocomplete(context);
    });

    return this;
  }

  /** Adds the child-only completion command to slash autocomplete. */
  private installAutocomplete(context: ExtensionContext): void {
    context.ui.addAutocompleteProvider((current) => ({
      getSuggestions: async (lines, cursorLine, cursorCol, options) => {
        const suggestions = await current.getSuggestions(
          lines,
          cursorLine,
          cursorCol,
          options,
        );
        const beforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
        const commandPrefix = beforeCursor.match(/^\/([^\s/]*)$/)?.[1];

        if (
          commandPrefix === undefined ||
          !COMMAND_NAME.startsWith(commandPrefix)
        )
          return suggestions;

        const item = {
          value: COMMAND_NAME,
          label: COMMAND_NAME,
          description: COMMAND_DESCRIPTION,
        };

        return {
          prefix: beforeCursor,
          items: [
            item,
            ...(suggestions?.items.filter(
              (suggestion) => suggestion.value !== item.value,
            ) ?? []),
          ],
        };
      },
      applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
        return current.applyCompletion(
          lines,
          cursorLine,
          cursorCol,
          item,
          prefix,
        );
      },
      shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
        return (
          current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ??
          true
        );
      },
    }));
  }
}
