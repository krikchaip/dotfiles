import { randomUUID } from "node:crypto";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { type Lifecycle, SessionStore } from "../store/session.ts";
import { Tmux } from "../tmux.ts";
import type { ParentRuntime } from "./runtime.ts";

/**
 * Parent-only tools.
 */
export class ParentTools {
  /**
   * Registers parent-only tools and coordinates them with the parent runtime.
   */
  public static register(pi: ExtensionAPI, runtime: ParentRuntime): void {
    new ParentTools(pi, runtime).registerAgent();
  }

  private constructor(
    private readonly pi: ExtensionAPI,
    private readonly runtime: ParentRuntime,
  ) {}

  private registerAgent(): ParentTools {
    const toolName = "Agent";

    this.pi.registerTool({
      name: toolName,
      label: toolName,
      description: "Launch or resume one asynchronous side-quest subagent.",

      promptSnippet: "Delegate or resume one asynchronous side quest.",
      promptGuidelines: [
        "The parent agent performs the main quest. A sub-agent performs one optional side quest.",
        "Delegate only a coherent, independently reviewable outcome with purpose, context, constraints, expected result, and acceptance evidence.",
        "Keep file reads, basic lookup, and retrieval-only work in the main quest. Review every returned side-quest result before acceptance.",
      ],

      parameters: Type.Object(
        {
          prompt: Type.String({
            minLength: 1,
            description:
              "Complete side-quest objective, context, constraints, and return contract.",
          }),
          description: Type.String({
            minLength: 1,
            description:
              "Short task label for the subagent pane and status row.",
          }),
          subagent_type: Type.Optional(
            StringEnum(["general-purpose"] as const, {
              description: `${toolName} identity. Omit for general-purpose.`,
            }),
          ),
          resume: Type.Optional(
            Type.String({
              description:
                "Absolute canonical path to a managed child session.jsonl file.",
            }),
          ),
          inherit_context: Type.Optional(
            Type.Boolean({
              description:
                "Copy the current parent conversation once for a new child.",
            }),
          ),
          interactive: Type.Optional(
            Type.Boolean({
              description:
                "Keep the child pane open after its current work ends.",
            }),
          ),
        },
        { additionalProperties: false },
      ),

      executionMode: "parallel",
      execute: async (
        _toolCallId,
        request,
        _signal,
        _onUpdate,
        context: ExtensionContext,
      ) => {
        Tmux.requireTmux();

        if (
          request.resume &&
          (request.subagent_type || request.inherit_context !== undefined)
        ) {
          throw new Error(
            `${toolName}.resume cannot include subagent_type or inherit_context.`,
          );
        }

        if (request.resume) {
          const manifest = SessionStore.readResumableManifest(request.resume);

          if (!manifest)
            throw new Error(
              `${toolName}.resume requires a canonical managed Side Quests session path.`,
            );

          if (manifest.parentId !== context.sessionManager.getSessionId())
            throw new Error(
              `${toolName}.resume cannot open a child from another parent session.`,
            );

          if (
            request.interactive === false &&
            manifest.lifecycle === "interactive"
          ) {
            throw new Error(
              `${toolName}.resume cannot demote an interactive subagent.`,
            );
          }

          const promoted = request.interactive
            ? SessionStore.updateManifest(manifest, {
                description: request.description.trim(),
                lifecycle: "interactive",
              })
            : SessionStore.updateManifest(manifest, {
                description: request.description.trim(),
                lifecycle: manifest.lifecycle,
              });

          const operation = await this.runtime.continue(
            promoted,
            request.prompt,
          );

          return this.acknowledgement(operation, promoted.sessionPath);
        }

        const parentId = context.sessionManager.getSessionId();
        const childId = randomUUID();

        const lifecycle: Lifecycle = request.interactive
          ? "interactive"
          : "autonomous";

        const manifest = SessionStore.create({
          parentId,
          childId,
          ownerId: this.runtime.ownerId,
          cwd: context.cwd,
          description: request.description.trim(),
          lifecycle,
          inheritContext: request.inherit_context ?? true,
          model: context.model
            ? `${context.model.provider}/${context.model.id}`
            : undefined,
          thinking: context.thinkingLevel,
          tools: this.pi.getActiveTools().filter((name) => name !== toolName),
          parentSessionPath: context.sessionManager.getSessionFile(),
        });

        try {
          this.runtime.launch(manifest, request.prompt);
          return this.acknowledgement("launched", manifest.sessionPath);
        } catch (cause) {
          throw new Error(
            `${toolName} could not launch ${manifest.sessionPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        }
      },
    });

    return this;
  }

  /**
   * Builds the standard Agent-tool acknowledgement payload.
   */
  private acknowledgement(
    operation: "launched" | "continued" | "reopened",
    sessionPath: string,
  ): AgentToolResult<{
    operation: "launched" | "continued" | "reopened";
    sessionPath: string;
  }> {
    return {
      details: { operation, sessionPath },
      content: [
        {
          type: "text",
          text: `Subagent ${operation}. Session: ${sessionPath}`,
        },
      ],
    };
  }
}
