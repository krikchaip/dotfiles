import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import {
  type AgentToolResult,
  type ExtensionAPI,
  type ExtensionContext,
  type Skill,
  stripFrontmatter,
} from "@earendil-works/pi-coding-agent";

import {
  AgentDefinitions,
  GENERAL_PURPOSE_AGENT,
  type SkillSelection,
  type ToolSelection,
} from "../agent-definitions.ts";
import {
  type Lifecycle,
  type ParentSystemPromptInputs,
  SessionStore,
} from "../store/session.ts";
import { Tmux } from "../tmux.ts";
import type { ParentRuntime } from "./runtime.ts";

/**
 * Lists child-only controls that are registered after normal tool policy resolves.
 */
const CHILD_CONTROL_TOOLS = new Set(["ask_parent", "subagent_done"]);

/**
 * Lists known tools that could create a nested sub-agent and must never reach a child.
 */
const SUBAGENT_SPAWNING_TOOLS = new Set([
  "Agent",
  "Task",
  "delegate",
  "spawn_agent",
  "subagent",
]);

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
    definitions = AgentDefinitions.resolve({
      agentDirectory:
        process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
      cwd: process.cwd(),
    }),
  ): ParentTools {
    pi.on("session_start", (_event, context) => {
      for (const diagnostic of definitions.diagnostics())
        context.ui.notify(
          `Side Quests ignored malformed agent definition ${diagnostic.path}: ${diagnostic.reason}`,
          "warning",
        );
    });

    const tools = new ParentTools(pi, runtime, definitions);
    pi.on("before_agent_start", (event) => {
      tools.parentSkills = [...(event.systemPromptOptions.skills ?? [])];
      tools.parentSystemPromptInputs = ParentTools.systemPromptInputs(
        event.systemPromptOptions,
      );
    });
    return tools.registerAgent();
  }

  private constructor(
    private readonly pi: ExtensionAPI,
    private readonly runtime: ParentRuntime,
    private readonly definitions: AgentDefinitions,
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
        `Treat the user's current goal as your main quest: you own and perform it. A side quest is a coherent branch with an independently reviewable outcome that you assign through ${toolName} to one sub-agent.`,
        `Call ${toolName} on your own initiative when a branch advances, unblocks, validates, or reduces risk for your main quest, has stable assumptions, and can receive exclusive non-overlapping ownership.`,
        "Keep a branch in your main quest when it overlaps your active ownership or its only outcome is reading, lookup, retrieval, or a simple helper edit. A sub-agent may use these actions to deliver research with synthesis, a design-question prototype, an independent implementation, a verified fix, an adversarial review, or another complete result. Record unrelated findings and ask the user whether to handle, delegate, or defer them.",
        `Before calling ${toolName}, define the sub-agent's exclusive ownership across files, decisions, and the outcome. Reserve that boundary for the assigned sub-agent until its result returns.`,
        `When calling ${toolName}, give the sub-agent a self-contained handoff with purpose, context, ownership boundary, stable assumptions, dependencies, constraints, expected outcome, acceptance evidence, and return contract. Require clear blockers and uncertainty instead of guesses.`,
        "Omit inherit_context for standard context continuity; omission defaults to true. Set inherit_context: false only for intentional context isolation, such as independent verification, an adversarial review, a second opinion, a competing design, or removing conversation noise. Set inherit_context: true only to override a named sub-agent that defaults to false. Apply this policy only to a new Agent launch.",
        `Use interactive: true on a new ${toolName} launch when the side quest needs several rounds of human dialogue, such as decision grilling, requirements discovery, prototype feedback, or human-in-the-loop review. The child pane then stays open until the human runs /subagent-done. Omit interactive for independent work that can return one final result.`,
        `After ${toolName} launches, continue your main-quest work outside the ownership boundary, regardless of size. If your main quest is blocked, let the turn settle and await the result without polling. Use resume for the same side quest; launch a new sub-agent only for a distinct branch or a fresh pass after the previous owner finishes.`,
        "On resume, omit subagent_type, inherit_context, and interactive. These fields configure only a new sub-agent and Agent.resume rejects them.",
        `Review work returned by ${toolName} proportionately without repeating the side quest. Check key evidence and integration points, run relevant code checks, inspect research sources quickly, and deepen review only as risk warrants. For a prototype, confirm that it runs and addresses the question, then ask the user to make the design judgment.`,
        ...this.definitions.guidelines(),
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
            StringEnum(this.definitions.names(), {
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

          this.runtime.assertRequiredTools(manifest);

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
            [],
            continuation.continuationKind,
          );
        }

        const agentName = request.subagent_type ?? GENERAL_PURPOSE_AGENT;
        const diagnostic = this.definitions.diagnostic(agentName);
        if (diagnostic)
          throw new Error(
            `${toolName}.subagent_type ${agentName} is malformed: ${diagnostic.reason}`,
          );

        const definition = this.definitions.get(agentName);
        if (!definition && agentName !== GENERAL_PURPOSE_AGENT)
          throw new Error(`${toolName}.subagent_type is unknown: ${agentName}`);

        if (definition?.model) {
          const [provider, modelId] = definition.model.split("/");
          if (!context.modelRegistry.find(provider, modelId))
            throw new Error(
              `${toolName}.subagent_type ${agentName} has an unknown model: ${definition.model}`,
            );
        }

        const skills = this.resolveSkills(
          definition?.availableSkills,
          definition?.preloadSkills ?? [],
          context,
          this.resolveTools(definition?.tools, definition?.disallowedTools),
        );

        const parentId = context.sessionManager.getSessionId();
        const childId = randomUUID();
        const lifecycle: Lifecycle =
          (request.interactive ?? definition?.interactive ?? false)
            ? "interactive"
            : "autonomous";

        const manifest = SessionStore.create({
          parentId,
          childId,
          ownerId: this.runtime.ownerId,
          cwd: context.cwd,
          agentName,
          displayName: definition?.displayName ?? agentName,
          description: request.description.trim(),
          lifecycle,
          inheritContext:
            request.inherit_context ?? definition?.inheritContext ?? true,
          model:
            definition?.model ??
            (context.model
              ? `${context.model.provider}/${context.model.id}`
              : undefined),
          thinking: definition?.thinking ?? context.thinkingLevel,
          tools: skills.tools,
          noSkills: skills.noSkills,
          skillPaths: skills.skillPaths,
          extensionPaths: this.explicitExtensionPaths(context.cwd),
          parentSystemPromptInputs: this.parentSystemPromptInputs,
          appendSystemPrompt:
            [
              skills.preloadPrompt,
              definition?.body
                ? [
                    "Follow these agent-specific instructions within the capability and lifecycle constraints above.",
                    "",
                    "<agent_instructions>",
                    definition.body,
                    "</agent_instructions>",
                  ].join("\n")
                : undefined,
            ]
              .filter(Boolean)
              .join("\n\n") || undefined,
          parentSessionPath: context.sessionManager.getSessionFile(),
        });

        try {
          const launched = await this.runtime.launch(manifest, request.prompt);
          const statuses: ("inherited" | "interactive")[] = [];
          if (launched.inheritContext) statuses.push("inherited");
          if (launched.lifecycle === "interactive")
            statuses.push("interactive");

          return this.acknowledgement(
            "launched",
            launched.sessionPath,
            statuses,
          );
        } catch (cause) {
          const child = await manifest.then(
            (created) => created.sessionPath,
            () => childId,
          );
          throw new Error(
            `${toolName} could not launch ${child}: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        }
      },
    });

    return this;
  }

  /**
   * Resolves and hard-denies the child normal-tool policy.
   */
  private resolveTools(
    selection: ToolSelection | undefined,
    disallowed: readonly string[] | undefined,
  ): readonly string[] {
    const active = this.pi
      .getActiveTools()
      .filter((name) => !SUBAGENT_SPAWNING_TOOLS.has(name));
    const registered = new Set(this.pi.getAllTools().map((tool) => tool.name));
    const selected =
      selection === undefined
        ? active
        : selection === "all"
          ? [...registered]
          : selection === "none"
            ? []
            : [...selection];

    for (const name of [...selected, ...(disallowed ?? [])])
      if (!registered.has(name) && !CHILD_CONTROL_TOOLS.has(name))
        throw new Error(`Unknown child tool: ${name}`);

    const denied = new Set([
      ...SUBAGENT_SPAWNING_TOOLS,
      ...(disallowed ?? []).filter((name) => !CHILD_CONTROL_TOOLS.has(name)),
    ]);
    return selected.filter(
      (name) => !denied.has(name) && !CHILD_CONTROL_TOOLS.has(name),
    );
  }

  /**
   * Resolves exact child skills and formats native preloaded-skill blocks.
   */
  private resolveSkills(
    selection: SkillSelection | undefined,
    preloadNames: readonly string[],
    context: ExtensionContext,
    tools: readonly string[],
  ): {
    noSkills: boolean;
    preloadPrompt?: string;
    skillPaths: readonly string[];
    tools: readonly string[];
  } {
    const discovered = this.parentSkills;
    const byName = new Map(discovered.map((skill) => [skill.name, skill]));
    const require = (name: string): Skill => {
      const skill = byName.get(name);
      if (!skill) throw new Error(`Unknown child skill: ${name}`);
      return skill;
    };
    const preloaded = preloadNames.map(require);
    const selected =
      selection === false
        ? []
        : selection === true || selection === undefined
          ? discovered.filter((skill) => !skill.disableModelInvocation)
          : selection.map(require);
    const lazy = selected.filter(
      (skill) => !preloaded.some((loaded) => loaded.name === skill.name),
    );
    const canRead = tools.includes("read");
    if (!canRead && lazy.length)
      context.ui.notify(
        "Side Quests omitted the child skill catalog because its tool policy lacks read.",
        "warning",
      );
    const preloadPrompt = preloaded
      .map((skill) => {
        const body = stripFrontmatter(
          readFileSync(skill.filePath, "utf8"),
        ).trim();
        return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${dirname(skill.filePath)}.\n\n${body}\n</skill>`;
      })
      .join("\n\n");
    return {
      noSkills: true,
      preloadPrompt: preloadPrompt || undefined,
      skillPaths: canRead ? lazy.map((skill) => skill.filePath) : [],
      tools,
    };
  }

  /** Records Pi's exact structured parent skill catalog. */
  private parentSkills: readonly Skill[] = [];

  /** Records frozen parent native prompt inputs for every new child manifest. */
  private parentSystemPromptInputs: ParentSystemPromptInputs | undefined;

  /**
   * Extracts only serializable native inputs that children must replay.
   */
  private static systemPromptInputs(
    options: Readonly<{
      appendSystemPrompt?: string;
      contextFiles?: readonly Readonly<{ content: string; path: string }>[];
      customPrompt?: string;
    }>,
  ): ParentSystemPromptInputs | undefined {
    const inputs: ParentSystemPromptInputs = {
      appendSystemPrompt: options.appendSystemPrompt,
      contextFiles: options.contextFiles?.map((file) => ({ ...file })),
      customPrompt: options.customPrompt,
    };
    return Object.values(inputs).some((value) => value !== undefined)
      ? inputs
      : undefined;
  }

  /**
   * Replays user-supplied one-off parent extensions without duplicating us.
   */
  private explicitExtensionPaths(cwd: string): readonly string[] {
    const ownEntries = new Set([
      new URL("../index.ts", import.meta.url).pathname,
      new URL("../child/index.ts", import.meta.url).pathname,
    ]);
    const paths: string[] = [];

    for (let index = 0; index < process.argv.length; index += 1) {
      const argument = process.argv[index];
      if (argument !== "--extension" && argument !== "-e") continue;

      const path = process.argv[index + 1];
      if (!path) continue;
      index += 1;

      const absolute = resolve(cwd, path);
      if (!ownEntries.has(absolute) && !paths.includes(absolute))
        paths.push(absolute);
    }

    return paths;
  }

  /**
   * Builds the standard Agent-tool acknowledgement payload.
   */
  private acknowledgement(
    operation: "launched" | "continued" | "reopened",
    sessionPath: string,
    statuses: ("inherited" | "interactive")[],
    continuationKind?: "answer" | "steer",
  ): AgentToolResult<{
    operation: "launched" | "continued" | "reopened";
    continuationKind?: "answer" | "steer";
    sessionPath: string;
    sideQuestPresentation: {
      version: 1;
      surface: "agent";
      resultStatus: "spawned" | "resumed" | "answered" | "steered";
      statuses: ("inherited" | "interactive")[];
    };
  }> {
    const resultStatus =
      operation === "launched"
        ? "spawned"
        : continuationKind === "answer"
          ? "answered"
          : operation === "continued"
            ? "steered"
            : "resumed";

    return {
      details: {
        operation,
        continuationKind,
        sessionPath,
        sideQuestPresentation: {
          version: 1,
          surface: "agent",
          resultStatus,
          statuses,
        },
      },
      content: [
        {
          type: "text",
          text: `Subagent ${operation}. Session: ${sessionPath}`,
        },
      ],
    };
  }
}
