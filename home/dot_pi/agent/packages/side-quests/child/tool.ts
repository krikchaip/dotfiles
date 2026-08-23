import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { AskParentRenderer } from "../renderer/ask-parent-renderer.ts";
import type { ChildRuntime } from "./runtime.ts";

/**
 * Child-only model tools.
 */
export class ChildTools {
  /**
   * Registers child-only tools and coordinates them with the child runtime.
   */
  public static register(pi: ExtensionAPI, runtime: ChildRuntime): ChildTools {
    return new ChildTools(pi, runtime).registerAskParent();
  }

  private constructor(
    private readonly pi: ExtensionAPI,
    private readonly runtime: ChildRuntime,
  ) {}

  /**
   * Registers the correlated parent-question tool.
   */
  private registerAskParent(): ChildTools {
    this.pi.registerTool({
      name: "ask_parent",
      label: "Ask parent",
      description:
        "Send one correlated question to the parent agent. Only one request can be pending at a time. The tool returns immediately so the side quest can continue while the parent prepares a response.",

      promptSnippet:
        "Send a question to the parent agent without pausing the side quest.",
      promptGuidelines: [
        "You are a sub-agent executing an assigned side quest. The parent agent owns the main quest and delegates side quests.",
        "Use ask_parent when your assigned side quest needs information or a decision from the parent agent.",
        "After calling ask_parent, you may continue the assigned side quest without waiting for a reply.",
        "Call ask_parent again only after the parent response arrives as a continuation message.",
      ],

      parameters: Type.Object(
        {
          prompt: Type.String({
            minLength: 1,
            description:
              "One concise correlated question for the parent agent.",
          }),
        },
        { additionalProperties: false },
      ),

      executionMode: "parallel",
      renderShell: "self",
      renderCall: AskParentRenderer.renderCall,
      renderResult: AskParentRenderer.renderResult,
      execute: async (_callId, params) => {
        this.runtime.askParent(params.prompt);

        return {
          content: [
            {
              type: "text" as const,
              text: "Your request was sent to the parent agent. Continue the side quest; do not wait for a reply.",
            },
          ],
          details: { pending: true },
        };
      },
    });

    return this;
  }
}
