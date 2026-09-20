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

  /** The Markdown file that supplied this definition. */
  path: string;
}>;

/**
 * Lists the supported Pi thinking levels.
 */
export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type ToolSelection = "all" | "none" | readonly string[];
export type SkillSelection = boolean | readonly string[];

/**
 * Records one malformed winning definition without falling back to a loser.
 */
export type AgentDefinitionDiagnostic = Readonly<{
  path: string;
  reason: string;
}>;

type DefinitionRecord =
  | Readonly<{ kind: "valid"; definition: AgentDefinition }>
  | Readonly<{ kind: "disabled" }>
  | Readonly<{ diagnostic: AgentDefinitionDiagnostic; kind: "invalid" }>;

/**
 * Owns agent-definition discovery, precedence, and catalog construction.
 */
export class AgentDefinitions {
  /**
   * Discovers definitions with project files shadowing same-name global files.
   */
  public static resolve(options: {
    agentDirectory: string;
    cwd: string;
  }): AgentDefinitions {
    const global = AgentDefinitions.files(
      join(options.agentDirectory, "agents"),
    );
    const project = AgentDefinitions.files(join(options.cwd, ".pi", "agents"));
    const paths = new Map([...global, ...project]);
    const records = new Map<string, DefinitionRecord>();

    for (const [name, path] of paths)
      records.set(name, AgentDefinitions.parse(name, path));

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
   * Returns the diagnostic for a winning malformed definition.
   */
  diagnostic(name: string): AgentDefinitionDiagnostic | undefined {
    const record = this.records.get(name);
    return record?.kind === "invalid" ? record.diagnostic : undefined;
  }

  /**
   * Lists one warning payload for every malformed winning definition.
   */
  diagnostics(): readonly AgentDefinitionDiagnostic[] {
    return [...this.records.values()].flatMap((record) =>
      record.kind === "invalid" ? [record.diagnostic] : [],
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
   * Parses the supported fields after Pi parses the YAML frontmatter.
   */
  private static parse(name: string, path: string): DefinitionRecord {
    try {
      const content = readFileSync(path, "utf8");
      if (!AgentDefinitions.hasFrontmatterBoundaries(content))
        throw new Error(
          "enabled definitions require YAML frontmatter boundaries",
        );

      const { body, frontmatter } = parseFrontmatter(content);
      const enabled = AgentDefinitions.boolean(frontmatter, "enabled", true);
      if (!enabled) return { kind: "disabled" };

      const description = AgentDefinitions.optionalText(
        frontmatter,
        "description",
      );
      if (name !== GENERAL_PURPOSE_AGENT && !description)
        throw new Error("named definitions require a non-empty description");

      return {
        kind: "valid",
        definition: {
          name,
          description,
          body: body.trim() || undefined,
          displayName:
            AgentDefinitions.optionalText(frontmatter, "display_name") ?? name,
          model: AgentDefinitions.optionalModel(frontmatter),
          thinking: AgentDefinitions.optionalThinking(frontmatter),
          tools: AgentDefinitions.optionalTools(frontmatter),
          disallowedTools:
            AgentDefinitions.optionalNames(frontmatter, "disallowed_tools") ??
            [],
          availableSkills: AgentDefinitions.optionalSkills(frontmatter),
          preloadSkills:
            AgentDefinitions.optionalNames(frontmatter, "preload_skills") ?? [],
          inheritContext: AgentDefinitions.optionalBoolean(
            frontmatter,
            "inherit_context",
          ),
          interactive: AgentDefinitions.optionalBoolean(
            frontmatter,
            "interactive",
          ),
          path,
        },
      };
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
   * Reads a supported boolean with a caller-supplied omission default.
   */
  private static boolean(
    frontmatter: Record<string, unknown>,
    field: string,
    fallback: boolean,
  ): boolean {
    return AgentDefinitions.optionalBoolean(frontmatter, field) ?? fallback;
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
