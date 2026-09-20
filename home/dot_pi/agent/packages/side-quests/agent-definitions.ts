import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

/**
 * Identifies the standard agent that is always available for delegation.
 */
export const GENERAL_PURPOSE_AGENT = "general-purpose";

/**
 * Records one usable agent definition after discovery and validation.
 */
export type AgentDefinition = Readonly<{
  /** The exact case-sensitive filename stem. */
  name: string;

  /** The optional parent-only agent selection description. */
  description?: string;

  /** The reusable child instructions, without boundary whitespace. */
  body?: string;

  /** The pane and widget label. */
  displayName: string;

  /** The exact optional child model override. */
  model?: string;

  /** The optional Pi thinking-level override. */
  thinking?: ThinkingLevel;

  /** The optional normal-tool replacement policy. */
  tools?: ToolSelection;

  /** The normal tools removed after the allowlist is applied. */
  disallowedTools: readonly string[];

  /** The optional lazy-skill replacement policy. */
  availableSkills?: SkillSelection;

  /** The full skill instructions loaded at child startup. */
  preloadSkills: readonly string[];

  /** The optional conversation-copying default. */
  inheritContext?: boolean;

  /** The optional lifecycle default. */
  interactive?: boolean;

  /** The highest-priority Markdown file in the resolved definition. */
  path: string;
}>;

/**
 * Lists the supported Pi thinking levels.
 */
export type ThinkingLevel =
  "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Selects normal child tools by sentinel or exact tool names.
 */
export type ToolSelection = "all" | "none" | readonly string[];

/**
 * Selects lazy child skills by boolean policy or exact skill names.
 */
export type SkillSelection = boolean | readonly string[];

/**
 * Records the participating layer that made one resolved identity malformed.
 */
export type AgentDefinitionDiagnostic = Readonly<{
  path: string;
  reason: string;
}>;

/**
 * Keeps one layer's registry-resolved fields available for strict validation.
 */
export type AgentDefinitionRuntimeLayer = Readonly<{
  name: string;
  path: string;
  model?: string;
  tools?: ToolSelection;
  disallowedTools?: readonly string[];
  availableSkills?: SkillSelection;
  preloadSkills?: readonly string[];
}>;

type DefinitionRecord =
  | Readonly<{
      definition: AgentDefinition;
      kind: "valid";
      runtimeLayers: readonly AgentDefinitionRuntimeLayer[];
    }>
  | Readonly<{
      kind: "disabled";
      runtimeLayers: readonly AgentDefinitionRuntimeLayer[];
    }>
  | Readonly<{ diagnostic: AgentDefinitionDiagnostic; kind: "invalid" }>;

type DefinitionFields = {
  description?: string;
  body?: string;
  displayName?: string;
  enabled?: boolean;
  model?: string;
  thinking?: ThinkingLevel;
  tools?: ToolSelection;
  disallowedTools?: readonly string[];
  availableSkills?: SkillSelection;
  preloadSkills?: readonly string[];
  inheritContext?: boolean;
  interactive?: boolean;
};

type DefinitionLayer = Readonly<{
  fields: Readonly<DefinitionFields>;
  path: string;
}>;

type LayerRecord =
  | Readonly<{ kind: "valid"; layer: DefinitionLayer }>
  | Readonly<{ diagnostic: AgentDefinitionDiagnostic; kind: "invalid" }>;

/**
 * Owns agent-definition discovery, overlay resolution, and catalog construction.
 */
export class AgentDefinitions {
  /**
   * Discovers definitions and overlays same-name project fields over global fields.
   */
  public static resolve(options: {
    agentDirectory: string;
    cwd: string;
  }): AgentDefinitions {
    const global = AgentDefinitions.files(
      join(options.agentDirectory, "agents"),
    );
    const project = AgentDefinitions.files(join(options.cwd, ".pi", "agents"));
    const names = new Set([...global.keys(), ...project.keys()]);
    const records = new Map<string, DefinitionRecord>();

    for (const name of names)
      records.set(
        name,
        AgentDefinitions.resolveLayers(
          name,
          global.get(name),
          project.get(name),
        ),
      );

    return new AgentDefinitions(records);
  }

  private constructor(
    private readonly records: ReadonlyMap<string, DefinitionRecord>,
  ) {}

  /**
   * Lists standard and usable named identities for `Agent.subagent_type`.
   */
  names(): readonly string[] {
    return [
      GENERAL_PURPOSE_AGENT,
      ...this.validNamed().map(({ name }) => name),
    ];
  }

  /**
   * Returns the valid definition for a new launch, or its selection failure.
   */
  get(name: string): AgentDefinition | undefined {
    const record = this.records.get(name);
    return record?.kind === "valid" ? record.definition : undefined;
  }

  /**
   * Returns the diagnostic for a malformed participating layer.
   */
  diagnostic(name: string): AgentDefinitionDiagnostic | undefined {
    const record = this.records.get(name);
    return record?.kind === "invalid" ? record.diagnostic : undefined;
  }

  /**
   * Lists one warning payload for every identity with a malformed layer.
   */
  diagnostics(): readonly AgentDefinitionDiagnostic[] {
    return [...this.records.values()].flatMap((record) =>
      record.kind === "invalid" ? [record.diagnostic] : [],
    );
  }

  /**
   * Lists every structurally valid layer that needs live registry validation.
   */
  runtimeLayers(): readonly AgentDefinitionRuntimeLayer[] {
    return [...this.records.values()].flatMap((record) =>
      record.kind === "invalid" ? [] : record.runtimeLayers,
    );
  }

  /**
   * Builds the contiguous parent Guidelines catalog.
   */
  guidelines(): readonly string[] {
    const named = this.validNamed().filter(({ description }) => !!description);

    if (!named.length) return [];

    const generalPurpose = this.get(GENERAL_PURPOSE_AGENT);
    const generalPurposeEntry = generalPurpose?.description
      ? [`Subagent ${GENERAL_PURPOSE_AGENT}. ${generalPurpose.description}`]
      : [];

    return [
      "When a side quest matches a specialized sub-agent below, delegate that side quest directly to that sub-agent.",
      ...named.map(
        (definition) =>
          `Subagent ${definition.name}. ${definition.description}`,
      ),
      ...generalPurposeEntry,
    ];
  }

  /**
   * Lists valid named definitions in one stable, code-point canonical order.
   */
  private validNamed(): readonly AgentDefinition[] {
    return [...this.records]
      .flatMap(([name, record]) =>
        name !== GENERAL_PURPOSE_AGENT && record.kind === "valid"
          ? [record.definition]
          : [],
      )
      .sort((left, right) =>
        left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
      );
  }

  /**
   * Reads direct Markdown children keyed by their case-sensitive filename stem.
   */
  private static files(directory: string): Map<string, string> {
    if (!existsSync(directory)) return new Map();

    return new Map(
      readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => [entry.name.slice(0, -3), join(directory, entry.name)]),
    );
  }

  /**
   * Validates both layers, overlays supplied project fields, and applies defaults.
   */
  private static resolveLayers(
    name: string,
    globalPath: string | undefined,
    projectPath: string | undefined,
  ): DefinitionRecord {
    const global = globalPath
      ? AgentDefinitions.parseLayer(globalPath)
      : undefined;
    const project = projectPath
      ? AgentDefinitions.parseLayer(projectPath)
      : undefined;

    if (global?.kind === "invalid") return global;
    if (project?.kind === "invalid") return project;

    const layers = [global, project].flatMap((record) =>
      record?.kind === "valid" ? [record.layer] : [],
    );
    const fields: Readonly<DefinitionFields> = Object.assign(
      {},
      ...layers.map((layer) => layer.fields),
    );
    const runtimeLayers = layers.map(({ fields: layer, path }) => ({
      name,
      path,
      model: layer.model,
      tools: layer.tools,
      disallowedTools: layer.disallowedTools,
      availableSkills: layer.availableSkills,
      preloadSkills: layer.preloadSkills,
    }));
    const path = projectPath ?? globalPath;
    if (!path)
      throw new Error(`Missing discovered definition path for ${name}`);

    if ((fields.enabled ?? true) === false)
      return { kind: "disabled", runtimeLayers };
    if (name !== GENERAL_PURPOSE_AGENT && !fields.description)
      return {
        kind: "invalid",
        diagnostic: {
          path,
          reason: "named definitions require a non-empty description",
        },
      };

    return {
      kind: "valid",
      runtimeLayers,
      definition: {
        name,
        description: fields.description,
        body: fields.body,
        displayName: fields.displayName ?? name,
        model: fields.model,
        thinking: fields.thinking,
        tools: fields.tools,
        disallowedTools: fields.disallowedTools ?? [],
        availableSkills: fields.availableSkills,
        preloadSkills: fields.preloadSkills ?? [],
        inheritContext: fields.inheritContext,
        interactive: fields.interactive,
        path,
      },
    };
  }

  /**
   * Parses and validates every supplied field without applying omission defaults.
   */
  private static parseLayer(path: string): LayerRecord {
    try {
      const content = readFileSync(path, "utf8");
      if (!AgentDefinitions.hasFrontmatterBoundaries(content))
        throw new Error(
          "agent definitions require YAML frontmatter boundaries",
        );

      const { body, frontmatter } = parseFrontmatter(content);
      const fields: DefinitionFields = {};
      const description = AgentDefinitions.optionalText(
        frontmatter,
        "description",
      );
      const displayName = AgentDefinitions.optionalText(
        frontmatter,
        "display_name",
      );
      const enabled = AgentDefinitions.optionalBoolean(frontmatter, "enabled");
      const model = AgentDefinitions.optionalModel(frontmatter);
      const thinking = AgentDefinitions.optionalThinking(frontmatter);
      const tools = AgentDefinitions.optionalTools(frontmatter);
      const disallowedTools = AgentDefinitions.optionalNames(
        frontmatter,
        "disallowed_tools",
      );
      const availableSkills = AgentDefinitions.optionalSkills(frontmatter);
      const preloadSkills = AgentDefinitions.optionalNames(
        frontmatter,
        "preload_skills",
      );
      const inheritContext = AgentDefinitions.optionalBoolean(
        frontmatter,
        "inherit_context",
      );
      const interactive = AgentDefinitions.optionalBoolean(
        frontmatter,
        "interactive",
      );
      const normalizedBody = body.trim();

      if (description !== undefined) fields.description = description;
      if (normalizedBody) fields.body = normalizedBody;
      if (displayName !== undefined) fields.displayName = displayName;
      if (enabled !== undefined) fields.enabled = enabled;
      if (model !== undefined) fields.model = model;
      if (thinking !== undefined) fields.thinking = thinking;
      if (tools !== undefined) fields.tools = tools;
      if (disallowedTools !== undefined)
        fields.disallowedTools = disallowedTools;
      if (availableSkills !== undefined)
        fields.availableSkills = availableSkills;
      if (preloadSkills !== undefined) fields.preloadSkills = preloadSkills;
      if (inheritContext !== undefined) fields.inheritContext = inheritContext;
      if (interactive !== undefined) fields.interactive = interactive;

      return { kind: "valid", layer: { fields, path } };
    } catch (cause) {
      return {
        kind: "invalid",
        diagnostic: {
          path,
          reason: cause instanceof Error ? cause.message : String(cause),
        },
      };
    }
  }

  /**
   * Checks delimiters at byte zero; a BOM or another prefix is invalid.
   */
  private static hasFrontmatterBoundaries(content: string): boolean {
    const opening = /^---[\t ]*\r?\n/.exec(content);
    if (!opening) return false;

    return /(?:^|\r?\n)---[\t ]*(?:\r?\n|$)/.test(
      content.slice(opening[0].length),
    );
  }

  /**
   * Reads a supported optional boolean while rejecting every present wrong type.
   */
  private static optionalBoolean(
    frontmatter: Record<string, unknown>,
    field: string,
  ): boolean | undefined {
    if (!(field in frontmatter)) return undefined;
    if (typeof frontmatter[field] !== "boolean")
      throw new Error(`${field} must be a boolean`);
    return frontmatter[field];
  }

  /**
   * Reads a required-when-present exact identifier.
   */
  private static optionalIdentifier(
    frontmatter: Record<string, unknown>,
    field: string,
  ): string | undefined {
    if (!(field in frontmatter)) return undefined;
    if (
      typeof frontmatter[field] !== "string" ||
      !frontmatter[field] ||
      frontmatter[field] !== frontmatter[field].trim()
    )
      throw new Error(`${field} must be a non-empty string`);
    return frontmatter[field];
  }

  /**
   * Reads an exact provider/model-id pair before registry validation.
   */
  private static optionalModel(
    frontmatter: Record<string, unknown>,
  ): string | undefined {
    const value = AgentDefinitions.optionalIdentifier(frontmatter, "model");
    if (value !== undefined) {
      const [provider, modelId, extra] = value.split("/");
      if (!provider || !modelId || extra !== undefined)
        throw new Error("model must be an exact provider/model-id pair");
    }
    return value;
  }

  /**
   * Reads Pi's supported thinking levels.
   */
  private static optionalThinking(
    frontmatter: Record<string, unknown>,
  ): ThinkingLevel | undefined {
    const value = AgentDefinitions.optionalIdentifier(frontmatter, "thinking");
    if (
      value !== undefined &&
      !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(
        value,
      )
    )
      throw new Error("thinking must be a supported Pi thinking level");
    return value as ThinkingLevel | undefined;
  }

  /**
   * Reads tools from a sentinel or a normalized comma-separated/YAML list.
   */
  private static optionalTools(
    frontmatter: Record<string, unknown>,
  ): ToolSelection | undefined {
    if (!("tools" in frontmatter)) return undefined;
    const value = frontmatter.tools;
    if (value === "all" || value === "none") return value;
    return AgentDefinitions.names(value, "tools");
  }

  /**
   * Reads the lazy-skill policy from a boolean or normalized name list.
   */
  private static optionalSkills(
    frontmatter: Record<string, unknown>,
  ): SkillSelection | undefined {
    if (!("available_skills" in frontmatter)) return undefined;
    const value = frontmatter.available_skills;
    if (typeof value === "boolean") return value;
    return AgentDefinitions.names(value, "available_skills");
  }

  /**
   * Reads an optional normalized comma-separated or YAML name list.
   */
  private static optionalNames(
    frontmatter: Record<string, unknown>,
    field: string,
  ): readonly string[] | undefined {
    if (!(field in frontmatter)) return undefined;
    return AgentDefinitions.names(frontmatter[field], field);
  }

  /**
   * Validates a CSV string or YAML string list and removes later duplicates.
   */
  private static names(value: unknown, field: string): readonly string[] {
    const names =
      typeof value === "string"
        ? value.split(",").map((name) => name.trim())
        : Array.isArray(value)
          ? value
          : undefined;
    if (
      !names ||
      names.some((name) => typeof name !== "string" || !name.trim())
    )
      throw new Error(
        `${field} must be a comma-separated string or string list`,
      );

    return [...new Set(names)];
  }

  /**
   * Reads and normalizes an optional non-empty scalar string.
   */
  private static optionalText(
    frontmatter: Record<string, unknown>,
    field: string,
  ): string | undefined {
    if (!(field in frontmatter)) return undefined;
    if (typeof frontmatter[field] !== "string")
      throw new Error(`${field} must be a non-empty string`);

    const value = frontmatter[field].trim().replace(/\s+/g, " ");
    if (!value) throw new Error(`${field} must be a non-empty string`);
    return value;
  }
}
