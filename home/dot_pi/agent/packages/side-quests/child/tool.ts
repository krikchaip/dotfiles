import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { AskParentRenderer } from "../renderer/ask-parent-renderer.ts";
import { WrapUpRenderer } from "../renderer/wrap-up-renderer.ts";
import type { ChildRuntime } from "./runtime.ts";

export const SUBAGENT_DONE_TOOL_NAME = "subagent_done";

/**
 * Child-only model tools.
 */
export class ChildTools {
  /**
   * Registers child-only tools and coordinates them with the child runtime.
   */
  public static register(pi: ExtensionAPI, runtime: ChildRuntime): ChildTools {
    return new ChildTools(pi, runtime)
      .registerAskParent()
      .registerSubagentDone();
  }

  private constructor(
    private readonly pi: ExtensionAPI,
    private readonly runtime: ChildRuntime,
  ) {}

  /**
   * Registers the correlated parent-question tool.
   */
  private registerAskParent(): ChildTools {
    const toolName = "ask_parent";

    this.pi.registerTool({
      name: toolName,
      label: "Ask parent",
      description:
        "Send one correlated question to the parent agent. Only one request can be pending at a time. The tool returns immediately so the side quest can continue while the parent prepares a response.",

      promptSnippet:
        "Send a question to the parent agent without pausing the side quest.",
      promptGuidelines: [
        "You are a sub-agent executing an assigned side quest. The parent agent owns the main quest and delegates side quests.",
        `Use ${toolName} when your assigned side quest needs information or a decision from the parent agent.`,
        `After calling ${toolName}, you may continue the assigned side quest without waiting for a reply.`,
        `Call ${toolName} again only after the parent response arrives as a continuation message.`,
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

  /**
   * Registers the explicit completion declaration for autonomous model work.
   */
  private registerSubagentDone(): ChildTools {
    const toolName = SUBAGENT_DONE_TOOL_NAME;
    const paramName = "result";

    this.pi.registerTool({
      name: toolName,
      label: "Subagent done",
      description: `When the assigned side quest is complete, your final action MUST be exactly one \`${toolName}\` call. Emit no normal assistant text before or after that call. Call it only after all work and validation are complete. Put the complete parent-facing handoff in \`${paramName}\`. A normal assistant response leaves the side quest unfinished.`,

      promptSnippet: `Finish an autonomous side quest with one parent-facing ${toolName} result.`,
      promptGuidelines: [
        `Autonomous sub-agents MUST use exactly one ${toolName}({ ${paramName} }) tool call as the final action after all assigned work and validation are complete.`,
        `Never finish an autonomous side quest with a normal assistant response. Emit no assistant text before or after the final ${toolName} call.`,
        `Call ${toolName} alone; do not combine it with any other tool call.`,
        `Put the entire parent-facing handoff only in ${toolName}.${paramName}, including the outcome, key evidence, blockers, and remaining uncertainty.`,
      ],
      parameters: Type.Object(
        {
          [paramName]: Type.String({
            minLength: 1,
            description:
              "The complete parent-facing handoff. Include the outcome, key evidence, blockers, and remaining uncertainty.",
          }),
        },
        { additionalProperties: false },
      ),
      executionMode: "sequential",
      renderShell: "self",
      renderCall: WrapUpRenderer.renderCall,
      renderResult: WrapUpRenderer.renderResult,
      execute: async (_callId, params) => {
        this.runtime.declareCompletion(params.result);

        return {
          content: [
            {
              type: "text" as const,
              text: "Side quest completion recorded. The parent agent will receive the result.",
            },
          ],
          details: { result: params.result.trim() },
          terminate: true,
        };
      },
    });

    return this;
  }
}
