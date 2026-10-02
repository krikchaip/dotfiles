import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import {
  type AgentToolResult,
  type ExtensionAPI,
  type ExtensionContext,
  type Skill,
  formatSkillsForPrompt,
  stripFrontmatter,
} from "@earendil-works/pi-coding-agent";

import {
  type AgentDefinitionDiagnostic,
  AgentDefinitions,
  type ConfiguredCapability,
  GENERAL_PURPOSE_AGENT,
} from "../agent-definitions.ts";
import {
  resolveSkillCapabilities,
  resolveToolCapabilities,
} from "../capability-policy.ts";
import type { CapabilitySelection } from "../capability-selection.ts";
import {
  ExtensionSelection,
  type ResolvedExtension,
  capturePiParentExtensions,
  createPiExtensionDiscovery,
} from "../extension-selection.ts";
import { createPiSkillSnapshot, discoverPiSkills } from "../skill-discovery.ts";
import {
  type ChildToolValidation,
  type Lifecycle,
  type ParentSystemPromptInputs,
  SessionStore,
} from "../store/session.ts";
import { Tmux } from "../tmux.ts";
import type { ParentRuntime } from "./runtime.ts";

/**
 * Resolves immutable child extension entrypoints from one configured field.
 */
export type ParentExtensionResolver = Readonly<{
  /** Returns the immutable loaded parent extension snapshot. */
  parent(): Promise<readonly ResolvedExtension[]>;

  /** Resolves omission or one explicit capability expression. */
  resolve(
    configured: ConfiguredCapability | undefined,
  ): Promise<readonly ResolvedExtension[]>;
}>;

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
    extensionResolver?: ParentExtensionResolver,
    skillDiscovery: (cwd: string) => Promise<readonly Skill[]> = (cwd) =>
      discoverPiSkills({
        agentDirectory:
          process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
        cwd,
      }),
  ): ParentTools {
    pi.on("session_start", (_event, context) => {
      for (const diagnostic of definitions.diagnostics())
        context.ui.notify(
          `Side Quests ignored malformed agent definition ${diagnostic.path}: ${diagnostic.reason}`,
          "warning",
        );
    });

    const tools = new ParentTools(
      pi,
      runtime,
      definitions,
      extensionResolver ??
        ParentTools.createExtensionResolver({
          agentDirectory:
            process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
          cwd: process.cwd(),
        }),
      skillDiscovery,
      createPiSkillSnapshot({
        agentDirectory:
          process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
        cwd: process.cwd(),
      }),
    );
    pi.on("before_agent_start", (event) => {
      // Ordinary prompts record native inputs only. Child resource resolution
      // can install Packages and must run only when Agent is actually invoked.
      tools.parentSkills = event.systemPromptOptions.skills ?? [];
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
    private readonly extensionResolver: ParentExtensionResolver,
    private readonly skillDiscovery: (cwd: string) => Promise<readonly Skill[]>,
    private readonly snapshotSkills: (
      skills: readonly Skill[],
    ) => Promise<readonly Skill[]>,
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

          const continued = {
            ...manifest,
            description: request.description.trim(),
          };
          const continuation = await this.runtime.continue(
            continued,
            request.prompt,
          );
          SessionStore.updateManifest(manifest, {
            description: continued.description,
            lifecycle: manifest.lifecycle,
          });

          return this.acknowledgement(
            continuation.operation,
            continued.sessionPath,
            [],
            continuation.continuationKind,
          );
        }

        const agentName = request.subagent_type ?? GENERAL_PURPOSE_AGENT;
        await this.validateRuntimeLayers(context);
        const diagnostic =
          this.definitions.diagnostic(agentName) ??
          this.runtimeDiagnostics.get(agentName);
        if (diagnostic)
          throw new Error(
            `${toolName}.subagent_type ${agentName} is malformed: ${diagnostic.reason}`,
          );

        const definition = this.definitions.get(agentName);
        if (!definition && agentName !== GENERAL_PURPOSE_AGENT)
          throw new Error(`${toolName}.subagent_type is unknown: ${agentName}`);

        const extensions = await this.extensionResolver.resolve(
          definition?.extensions,
        );
        const tools = this.pruneRemovedExtensionTools(
          this.resolveTools(
            definition?.tools?.selection,
            !!definition?.extensions,
          ),
          definition?.tools?.selection,
          definition?.extensions?.selection,
          definition?.extensions?.selection.kind === "parent-relative"
            ? await this.extensionResolver.parent()
            : [],
          extensions,
        );
        const discoveredSkills = definition?.skills
          ? await this.skillDiscovery(context.cwd)
          : this.parentSkills;
        const skills = await this.resolveSkills(
          definition?.skills?.selection,
          context,
          tools,
          discoveredSkills,
          definition?.tools?.selection.kind === "all",
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
          discoverTools:
            definition?.tools?.selection.kind === "all" ? true : undefined,
          toolValidation: this.deferredToolValidation.get(agentName),
          noSkills: skills.noSkills,
          skillPaths: skills.skillPaths,
          extensionPaths: extensions.map(({ path }) => path),
          extensionIntegrity: extensions.every(({ integrity }) => integrity)
            ? extensions.flatMap(({ integrity }) =>
                integrity ? [integrity] : [],
              )
            : undefined,
          parentSystemPromptInputs: this.parentSystemPromptInputs,
          appendSystemPrompt:
            [
              skills.skillPrompt,
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
          const launched = await this.runtime.launch(manifest, request.prompt, {
            removeSessionOnFailure: true,
          });
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
   * Validates every layer against live model, tool, and skill registries once.
   */
  private validateRuntimeLayers(context: ExtensionContext): Promise<void> {
    this.runtimeLayerValidation ??= this.validateRuntimeLayersOnce(context);
    return this.runtimeLayerValidation;
  }

  /**
   * Validates every structurally valid layer against live parent registries.
   */
  private async validateRuntimeLayersOnce(
    context: ExtensionContext,
  ): Promise<void> {
    const layers = this.definitions.runtimeLayers();
    const discoveredSkills = layers.some((layer) => layer.skills)
      ? await this.skillDiscovery(context.cwd)
      : this.parentSkills;
    for (const layer of layers) {
      if (this.runtimeDiagnostics.has(layer.name)) continue;

      try {
        if (layer.model) {
          const [provider, modelId] = layer.model.split("/");
          if (!context.modelRegistry.find(provider, modelId))
            throw new Error(`unknown model: ${layer.model}`);
        }

        const selectedTools = this.resolveTools(
          layer.tools,
          !!(layer.extensions ?? this.definitions.get(layer.name)?.extensions),
        );
        if (layer.tools) {
          const registered = new Set(
            this.pi.getAllTools().map(({ name }) => name),
          );
          const names = selectedTools.filter((name) => !registered.has(name));
          if (names.length) {
            const checks = this.deferredToolValidation.get(layer.name) ?? [];
            this.deferredToolValidation.set(layer.name, [
              ...checks,
              { path: layer.path, names },
            ]);
          }
        }
        this.resolveSkillNames(layer.skills, discoveredSkills);
        if (layer.extensions)
          await this.extensionResolver.resolve({
            selection: layer.extensions,
            sourcePath: layer.path,
          });
      } catch (cause) {
        const diagnostic: AgentDefinitionDiagnostic = {
          path: layer.path,
          reason: cause instanceof Error ? cause.message : String(cause),
        };
        this.runtimeDiagnostics.set(layer.name, diagnostic);
        context.ui.notify(
          `Side Quests ignored malformed agent definition ${diagnostic.path}: ${diagnostic.reason}`,
          "warning",
        );
      }
    }
  }

  /**
   * Resolves and hard-denies the child normal-tool policy.
   */
  private resolveTools(
    selection: CapabilitySelection | undefined,
    deferUnknown = false,
  ): readonly string[] {
    return resolveToolCapabilities(
      selection,
      {
        active: this.pi.getActiveTools(),
        registered: this.pi.getAllTools().map((tool) => tool.name),
      },
      { deferUnknown },
    );
  }

  /**
   * Prunes inherited tools whose every loaded parent provider was removed.
   */
  private pruneRemovedExtensionTools(
    tools: readonly string[],
    toolSelection: CapabilitySelection | undefined,
    extensionSelection: CapabilitySelection | undefined,
    parentExtensions: readonly ResolvedExtension[],
    selectedExtensions: readonly ResolvedExtension[],
  ): readonly string[] {
    if (
      extensionSelection?.kind !== "parent-relative" ||
      (toolSelection && toolSelection.kind !== "parent-relative")
    )
      return tools;

    const retainedProviderPaths = new Set(
      selectedExtensions.map(({ providerPath }) => providerPath),
    );
    const explicitTools = new Set(
      toolSelection?.kind === "parent-relative"
        ? toolSelection.entries
            .filter(({ kind }) => kind === "include")
            .map(({ name }) => name)
        : [],
    );
    const providers = new Map<string, ResolvedExtension[]>();
    for (const extension of parentExtensions)
      for (const tool of extension.providedTools) {
        const entries = providers.get(tool) ?? [];
        entries.push(extension);
        providers.set(tool, entries);
      }

    return tools.filter((tool) => {
      if (explicitTools.has(tool)) return true;
      const entries = providers.get(tool);
      return (
        !entries ||
        entries.some(({ providerPath }) =>
          retainedProviderPaths.has(providerPath),
        )
      );
    });
  }

  /**
   * Freezes explicit hidden-skill catalogs and preloaded instructions for the child.
   */
  private async resolveSkills(
    selection: CapabilitySelection | undefined,
    context: ExtensionContext,
    tools: readonly string[],
    discovered: readonly Skill[],
    discoverTools: boolean,
  ): Promise<{
    noSkills: boolean;
    skillPrompt?: string;
    skillPaths: readonly string[];
    tools: readonly string[];
  }> {
    const available = !selection
      ? this.parentSkills
      : selection.kind === "all"
        ? discovered
        : [...this.parentSkills, ...discovered];
    const byName = new Map(available.map((skill) => [skill.name, skill]));
    const require = (name: string): Skill => {
      const skill = byName.get(name);
      if (!skill) throw new Error(`Unknown child skill: ${name}`);
      return skill;
    };
    const resolved = this.resolveSkillNames(selection, discovered);
    const selectedPreloaded = resolved.preloaded.map(require);
    const selectedLazy = resolved.lazy.map(require);
    const canRead = discoverTools || tools.includes("read");
    if (!canRead && selectedLazy.length)
      context.ui.notify(
        "Side Quests omitted the child skill catalog because its tool policy lacks read.",
        "warning",
      );
    const selected = await this.snapshotSkills([
      ...selectedPreloaded,
      ...(canRead ? selectedLazy : []),
    ]);
    const preloaded = selected.slice(0, selectedPreloaded.length);
    const lazy = selected.slice(selectedPreloaded.length);
    const preloadPrompt = preloaded
      .map((skill) => {
        const body = stripFrontmatter(
          readFileSync(skill.filePath, "utf8"),
        ).trim();
        return `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${dirname(skill.filePath)}.\n\n${body}\n</skill>`;
      })
      .join("\n\n");
    // Native CLI skill loading keeps hidden skills out of its catalog even when
    // selected explicitly. Use Pi's formatter without changing their source files.
    const hiddenCatalog = canRead
      ? formatSkillsForPrompt(
          lazy
            .filter((skill) => skill.disableModelInvocation)
            .map((skill) => ({ ...skill, disableModelInvocation: false })),
        )
      : "";
    return {
      noSkills: true,
      skillPrompt:
        [hiddenCatalog, preloadPrompt].filter(Boolean).join("\n\n") ||
        undefined,
      skillPaths: lazy.map((skill) => skill.filePath),
      tools,
    };
  }

  /**
   * Uses fresh native discovery for selection and the exact parent lazy baseline.
   */
  private resolveSkillNames(
    selection: CapabilitySelection | undefined,
    discovered: readonly Skill[],
  ): {
    lazy: readonly string[];
    preloaded: readonly string[];
  } {
    return resolveSkillCapabilities(selection, {
      discovered: (selection?.kind === "all"
        ? discovered
        : [...this.parentSkills, ...discovered]
      ).map((skill) => ({
        name: skill.name,
        modelInvocable: !skill.disableModelInvocation,
      })),
      parent: this.parentSkills
        .filter((skill) => !skill.disableModelInvocation)
        .map((skill) => skill.name),
    });
  }

  /** Records Pi's exact structured parent skill catalog. */
  private parentSkills: readonly Skill[] = [];

  /** Records frozen parent native prompt inputs for every new child manifest. */
  private parentSystemPromptInputs: ParentSystemPromptInputs | undefined;

  /** Records one live-registry failure for each invalid resolved identity. */
  private readonly runtimeDiagnostics = new Map<
    string,
    AgentDefinitionDiagnostic
  >();

  /** Carries unresolved checks from every layer into first child readiness. */
  private readonly deferredToolValidation = new Map<
    string,
    readonly ChildToolValidation[]
  >();

  /** Shares one asynchronous live-registry validation across parent turns. */
  private runtimeLayerValidation: Promise<void> | undefined;

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
   * Creates one resolver with a startup-frozen complete parent snapshot.
   */
  private static createExtensionResolver(options: {
    agentDirectory: string;
    cwd: string;
  }): ParentExtensionResolver {
    const discovery = createPiExtensionDiscovery(options);
    const selection = new ExtensionSelection(discovery);
    const parentSnapshot = capturePiParentExtensions(options);
    return {
      parent: parentSnapshot,
      resolve: async (configured) =>
        selection.resolve(configured, await parentSnapshot()),
    };
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
