import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import type { ParentRuntime } from "./runtime.ts";
import type { ParentUI } from "./ui.ts";

/**
 * Parent-only slash commands.
 */
export class ParentCommands {
  /**
   * Registers parent-only slash commands.
   */
  public static register(
    pi: ExtensionAPI,
    runtime: ParentRuntime,
    ui: ParentUI,
  ): ParentCommands {
    return new ParentCommands(pi, runtime, ui).registerSideQuests();
  }

  private constructor(
    private readonly pi: ExtensionAPI,
    private readonly runtime: ParentRuntime,
    private readonly ui: ParentUI,
  ) {}

  /**
   * Registers navigation and cancellation for live sub-agent panes.
   */
  private registerSideQuests(): ParentCommands {
    this.pi.registerCommand("side-quests", {
      description: "Open or close a live Side Quests subagent pane.",
      handler: async (_args, context) => {
        await this.handleSideQuests(context);
      },
    });

    this.pi.registerShortcut("shift+up", {
      description: "Open Side Quests pane navigation",
      handler: async (context) => {
        await this.handleSideQuests(context);
      },
    });

    return this;
  }

  /**
   * Keeps pane navigation mounted while it focuses and closes children.
   */
  private async handleSideQuests(context: ExtensionContext): Promise<void> {
    if (context.mode !== "tui") return;

    if (!this.runtime.children().length) {
      context.ui.notify("No live Side Quests subagents.", "info");
      return;
    }

    await this.ui.selectLiveChild(
      context,
      (childId) => {
        this.runtime.close(childId);
      },
      (childId) => {
        this.runtime.focus(childId);
      },
    );
  }
}
