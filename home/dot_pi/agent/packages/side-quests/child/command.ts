import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import type { ChildRuntime } from "./runtime.ts";

const COMMAND_NAME = "subagent-done";
const WRAP_UP_FLAG = "--wrap-up";
const COMMAND_DESCRIPTION = "Finish this interactive Side Quests subagent.";

/**
 * Child-only slash commands and command completion.
 */
export class ChildCommands {
  /**
   * Registers child-only command behavior for the child runtime lifecycle.
   */
  public static register(
    pi: ExtensionAPI,
    runtime: ChildRuntime,
  ): ChildCommands {
    return new ChildCommands(pi, runtime).installEventListeners();
  }

  /** Reports whether the interactive-only command is registered. */
  private doneCommandInstalled = false;

  private constructor(
    private readonly pi: ExtensionAPI,
    private readonly runtime: ChildRuntime,
  ) {}

  /**
   * Installs command completion and listens for interactive lifecycle promotion.
   */
  private installEventListeners(): ChildCommands {
    this.runtime.onInteractive(() => this.installDoneCommand());
    this.pi.on("session_start", (_event, context) => {
      this.installAutocomplete(context);
    });

    return this;
  }

  /**
   * Registers explicit completion for interactive child sessions once.
   */
  private installDoneCommand(): void {
    if (this.doneCommandInstalled) return;
    this.doneCommandInstalled = true;

    this.pi.registerCommand(COMMAND_NAME, {
      description: COMMAND_DESCRIPTION,
      getArgumentCompletions: (prefix) => {
        const normalized = prefix.trimStart();
        return normalized !== WRAP_UP_FLAG &&
          WRAP_UP_FLAG.startsWith(normalized)
          ? [
              {
                value: WRAP_UP_FLAG,
                label: WRAP_UP_FLAG,
                description: "Synthesize a final tool-disabled parent handoff.",
              },
            ]
          : null;
      },
      handler: async (args, context) => {
        const normalized = args.trim();
        if (normalized && normalized !== WRAP_UP_FLAG) {
          context.ui.notify(
            `Usage: /${COMMAND_NAME} [${WRAP_UP_FLAG}]`,
            "warning",
          );
          return;
        }

        if (this.runtime.isActive()) {
          context.ui.notify(
            "Wait for the current turn or interrupt it first.",
            "warning",
          );
          return;
        }

        if (!normalized) {
          this.runtime.complete(context);
          return;
        }

        try {
          await this.runtime.wrapUp();
        } catch (cause) {
          context.ui.notify(
            cause instanceof Error ? cause.message : String(cause),
            "error",
          );
        }
      },
    });
  }

  /**
   * Adds autocomplete only after the interactive command becomes available.
   */
  private installAutocomplete(context: ExtensionContext): void {
    const isDoneCommandInstalled = () => this.doneCommandInstalled;

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
          !isDoneCommandInstalled() ||
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
