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
  public static register(
    pi: ExtensionAPI,
    runtime: ParentRuntime,
  ): ParentTools {
    return new ParentTools(pi, runtime).registerAgent();
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
      description:
        "Launch or resume a sub-agent in a separate session to perform one asynchronous side quest.",

      promptSnippet:
        "Delegate a coherent, non-overlapping branch of the user's goal to a sub-agent, or resume that sub-agent.",
      promptGuidelines: [
        `The user's current goal is the main quest. The parent agent owns and performs it. A side quest is a coherent branch with an independently reviewable outcome, assigned through ${toolName} to one sub-agent.`,
        `Call ${toolName} on your own initiative when a branch advances, unblocks, validates, or reduces risk for the main quest, has stable assumptions, and can receive exclusive non-overlapping ownership.`,
        `Before calling ${toolName}, define exclusive ownership across files, decisions, and the outcome. The parent agent and sibling sub-agents stay outside that boundary until the result returns.`,
        `Keep a branch in the main quest when it overlaps the parent agent's active ownership or its only outcome is reading, lookup, retrieval, or a simple helper edit. A side quest assigned through ${toolName} may use these actions to deliver research with synthesis, a design-question prototype, an independent implementation, a verified fix, an adversarial review, or another complete result. Record unrelated findings and ask the user whether to handle, delegate, or defer them.`,
        `When calling ${toolName}, give the sub-agent a self-contained handoff with purpose, context, ownership boundary, stable assumptions, dependencies, constraints, expected outcome, acceptance evidence, and return contract. Require clear blockers and uncertainty instead of guesses.`,
        `Use interactive: true on a new ${toolName} launch when the side quest needs several rounds of human dialogue, such as decision grilling, requirements discovery, prototype feedback, or human-in-the-loop review. Interactive mode keeps the child pane open until the human runs /subagent-done. Omit interactive for independent work that can return one final result.`,
        `After ${toolName} launches, continue any main-quest work outside the ownership boundary, regardless of size. If the main quest is blocked, let the turn settle and await the result without polling. Use resume for the same side quest; launch a new sub-agent only for a distinct branch or a fresh pass after the previous owner finishes.`,
        "Omit inherit_context for standard context continuity; omission defaults to true. Set inherit_context: false only for intentional context isolation, such as independent verification, an adversarial review, a second opinion, a competing design, or removing conversation noise. Set inherit_context: true only to override a named sub-agent that defaults to false. This policy applies only to a new Agent launch.",
        "On resume, omit subagent_type, inherit_context, and interactive. These fields configure only a new sub-agent and Agent.resume rejects them.",
        `Review work returned by ${toolName} proportionately without repeating the side quest. Check key evidence and integration points, run relevant code checks, inspect research sources quickly, and deepen review only as risk warrants. For a prototype, confirm that it runs and addresses the question, then ask the user to make the design judgment.`,
      ],

      parameters: Type.Object(
        {
          prompt: Type.String({
            minLength: 1,
            description:
              "New launch: self-contained side-quest handoff. Resume: continuation instructions or an answer to the sub-agent.",
          }),
          description: Type.String({
            minLength: 1,
            description:
              "Side-quest label, preferably two to six words, shown in the pane and status row. On resume, describe the current continuation.",
          }),
          subagent_type: Type.Optional(
            StringEnum(["general-purpose"] as const, {
              description:
                "Sub-agent role for a new side quest. Omit to use general-purpose. Use only for a new launch; omit on resume.",
            }),
          ),
          resume: Type.Optional(
            Type.String({
              description:
                "Canonical session.jsonl path returned for an existing sub-agent. Set it to continue the same side quest; omit it to launch a new sub-agent.",
            }),
          ),
          inherit_context: Type.Optional(
            Type.Boolean({
              description:
                "New launch only. Omit for standard context continuity; omission defaults to true. Set false only for intentional context isolation, such as independent verification, an adversarial review, a second opinion, a competing design, or removing conversation noise. Set true only to override a named sub-agent that defaults to false. Omit on resume.",
            }),
          ),
          interactive: Type.Optional(
            Type.Boolean({
              description:
                "Lifecycle only. On launch, true keeps the pane open after completion; omission uses autonomous lifecycle. Use only for a new launch; omit on resume.",
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
          (request.subagent_type !== undefined ||
            request.inherit_context !== undefined ||
            request.interactive !== undefined)
        ) {
          throw new Error(
            `${toolName}.resume cannot include subagent_type, inherit_context, or interactive.`,
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

          const continued = SessionStore.updateManifest(manifest, {
            description: request.description.trim(),
            lifecycle: manifest.lifecycle,
          });

          const continuation = await this.runtime.continue(
            continued,
            request.prompt,
          );

          return this.acknowledgement(
            continuation.operation,
            continued.sessionPath,
            continuation.continuationKind,
          );
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
    continuationKind?: "answer" | "steer",
  ): AgentToolResult<{
    operation: "launched" | "continued" | "reopened";
    continuationKind?: "answer" | "steer";
    sessionPath: string;
  }> {
    return {
      details: { operation, continuationKind, sessionPath },
      content: [
        {
          type: "text",
          text: `Subagent ${operation}. Session: ${sessionPath}`,
        },
      ],
    };
  }
}
