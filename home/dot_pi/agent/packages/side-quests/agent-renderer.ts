import {
  type ExtensionAPI,
  type Theme,
  ToolExecutionComponent,
  keyHint,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

import { SessionStore } from "./store/session.ts";

const PATCH_STATE = Symbol.for("side-quests:agent-renderer-state");

type RendererOwner = {
  isPartial?: unknown;
  result?: { isError?: unknown };
  toolName?: unknown;
};
type RendererGetter = (this: RendererOwner) => unknown;
type RendererPrototype = Record<PropertyKey, unknown>;

type AgentDisplay = Readonly<{
  description: string;
  mode: "fresh" | "resumed";
  type: string;
  inheritContext?: boolean;
  interactive?: boolean;
}>;

type AgentStatuses = Readonly<{
  inheritContext?: boolean;
  interactive?: boolean;
}>;

type RefreshContext = Readonly<{
  ui: {
    getToolsExpanded(): boolean;
    setToolsExpanded(expanded: boolean): void;
  };
}>;

interface RendererState {
  installed: boolean;
  installedGetCallRenderer?: RendererGetter;
  installedGetResultRenderer?: RendererGetter;
  installedHasRendererDefinition?: RendererGetter;
  originalGetCallRenderer?: RendererGetter;
  originalGetResultRenderer?: RendererGetter;
  originalHasRendererDefinition?: RendererGetter;
}

/**
 * Retains source text for transcript modules that compose compact tool rows.
 */
class ToolCallText extends Text {
  public constructor(public readonly value: string) {
    super(value, 0, 0);
  }
}

/**
 * Owns Agent tool rendering and composition with the active renderer stack.
 */
export class AgentRenderer {
  /** Caches persisted launch options by canonical child session path. */
  private static readonly manifestStatusCache = new Map<
    string,
    AgentStatuses
  >();

  /**
   * Registers renderer installation at extension load and TUI session start.
   */
  public static register(pi: ExtensionAPI): AgentRenderer {
    const renderer = new AgentRenderer(pi);

    AgentRenderer.install();
    renderer.installEventListeners();

    return renderer;
  }

  /**
   * Installs the idempotent adapter around the active Pi renderer stack.
   */
  public static install(): boolean {
    const rendererState = AgentRenderer.state();
    const prototype =
      ToolExecutionComponent.prototype as unknown as RendererPrototype;
    const ownsCallRenderer =
      prototype.getCallRenderer === rendererState.installedGetCallRenderer;
    const ownsResultRenderer =
      prototype.getResultRenderer === rendererState.installedGetResultRenderer;
    const ownsRendererDefinition =
      prototype.hasRendererDefinition ===
      rendererState.installedHasRendererDefinition;

    if (
      rendererState.installed &&
      ownsCallRenderer &&
      ownsResultRenderer &&
      ownsRendererDefinition
    ) {
      return true;
    }

    const originalGetCallRenderer = ownsCallRenderer
      ? rendererState.originalGetCallRenderer
      : rendererState.installed
        ? prototype.getCallRenderer
        : (rendererState.originalGetCallRenderer ?? prototype.getCallRenderer);
    const originalGetResultRenderer = ownsResultRenderer
      ? rendererState.originalGetResultRenderer
      : rendererState.installed
        ? prototype.getResultRenderer
        : (rendererState.originalGetResultRenderer ??
          prototype.getResultRenderer);
    const originalHasRendererDefinition = ownsRendererDefinition
      ? rendererState.originalHasRendererDefinition
      : prototype.hasRendererDefinition;

    if (
      typeof originalGetCallRenderer !== "function" ||
      typeof originalGetResultRenderer !== "function" ||
      typeof originalHasRendererDefinition !== "function"
    ) {
      return false;
    }

    rendererState.originalGetCallRenderer =
      originalGetCallRenderer as RendererGetter;
    rendererState.originalGetResultRenderer =
      originalGetResultRenderer as RendererGetter;
    rendererState.originalHasRendererDefinition =
      originalHasRendererDefinition as RendererGetter;

    const hasRendererDefinition = function hasAgentRendererDefinition(
      this: RendererOwner,
    ): unknown {
      if (this.toolName === "Agent") return true;
      return rendererState.originalHasRendererDefinition?.call(this);
    };

    const getCallRenderer = function getAgentCallRenderer(
      this: RendererOwner,
    ): unknown {
      const original = rendererState.originalGetCallRenderer?.call(this);

      if (this.toolName !== "Agent") return original;
      if (typeof original !== "function") return AgentRenderer.renderCall;

      return (args: unknown, theme: unknown, context: unknown) =>
        original(AgentRenderer.hostArgs(args), theme, context);
    };

    const getResultRenderer = function getAgentResultRenderer(
      this: RendererOwner,
    ): unknown {
      const original = rendererState.originalGetResultRenderer?.call(this);

      const isSideQuestsTool =
        this.toolName === "Agent" || this.toolName === "ask_parent";

      if (!isSideQuestsTool) return original;
      if (this.isPartial === true) return original;
      if (this.result?.isError === true) return AgentRenderer.renderError;
      if (this.toolName === "ask_parent") return original;

      return AgentRenderer.renderResult;
    };

    prototype.hasRendererDefinition = hasRendererDefinition;
    prototype.getCallRenderer = getCallRenderer;
    prototype.getResultRenderer = getResultRenderer;

    rendererState.installed = true;
    rendererState.installedHasRendererDefinition = hasRendererDefinition;
    rendererState.installedGetCallRenderer = getCallRenderer;
    rendererState.installedGetResultRenderer = getResultRenderer;

    return true;
  }

  /**
   * Refreshes existing tool rows after renderer installation.
   */
  public static refresh(context: RefreshContext): void {
    const expanded = context.ui.getToolsExpanded();

    context.ui.setToolsExpanded(!expanded);
    context.ui.setToolsExpanded(expanded);
  }

  /**
   * Formats the stable summary shown in one Agent tool header.
   */
  public static summary(args: unknown): string {
    const agent = AgentRenderer.display(args);
    const resumed = agent.mode === "resumed" ? " (resumed)" : "";

    return `${agent.type}${resumed} :: ${agent.description}`;
  }

  /**
   * Returns the effective true launch options shown in collapsed output.
   */
  public static collapsedStatuses(
    args: unknown,
    path: string,
  ): readonly ("inherited" | "interactive")[] {
    if (AgentRenderer.display(args).mode === "resumed") return [];

    const statuses = AgentRenderer.statuses(args, path);
    const labels: ("inherited" | "interactive")[] = [];

    if (statuses.inheritContext === true) labels.push("inherited");
    if (statuses.interactive === true) labels.push("interactive");

    return labels;
  }

  /**
   * Builds the expanded Agent result body.
   */
  public static expandedResultLines(
    args: unknown,
    path: string,
    prompt: string,
  ): string[] {
    const details = [`session path: ${path}`, "\u2800", prompt];
    if (AgentRenderer.display(args).mode === "resumed") return details;

    const statuses = AgentRenderer.statuses(args, path);

    return [
      `inherit_context: ${AgentRenderer.statusValue(statuses.inheritContext)} · interactive: ${AgentRenderer.statusValue(statuses.interactive)}`,
      ...details,
    ];
  }

  private constructor(private readonly pi: ExtensionAPI) {}

  /**
   * Registers session-scoped renderer recovery after all extensions load.
   */
  private installEventListeners(): void {
    this.pi.on("session_start", (_event, context) => {
      if (context.mode === "tui") AgentRenderer.install();
    });
  }

  /**
   * Returns process-wide state used to prevent duplicate prototype wrappers.
   */
  private static state(): RendererState {
    const globals = globalThis as typeof globalThis & {
      [PATCH_STATE]?: RendererState;
    };

    globals[PATCH_STATE] ??= { installed: false };

    return globals[PATCH_STATE];
  }

  /**
   * Resolves stable display fields from one Agent call.
   */
  private static display(args: unknown): AgentDisplay {
    const prompt = AgentRenderer.stringArg(args, "prompt") ?? "Agent";

    return {
      description: AgentRenderer.stringArg(args, "description") ?? prompt,
      mode: AgentRenderer.stringArg(args, "resume") ? "resumed" : "fresh",
      type: AgentRenderer.stringArg(args, "subagent_type") ?? "general-purpose",
      inheritContext: AgentRenderer.booleanArg(args, "inherit_context"),
      interactive: AgentRenderer.booleanArg(args, "interactive"),
    };
  }

  /**
   * Supplies the stable Agent summary while preserving host renderer control.
   */
  private static hostArgs(args: unknown): unknown {
    if (typeof args !== "object" || args === null) return args;

    return {
      ...(args as Record<string, unknown>),
      description: AgentRenderer.summary(args),
    };
  }

  /**
   * Resolves persisted values before passed parameters and launch defaults.
   */
  private static statuses(args: unknown, path: string): AgentStatuses {
    const agent = AgentRenderer.display(args);
    const manifest = AgentRenderer.manifestStatuses(path);

    return {
      inheritContext: manifest.inheritContext ?? agent.inheritContext ?? true,
      interactive: manifest.interactive ?? agent.interactive ?? false,
    };
  }

  /**
   * Reads and caches persisted launch options for one managed session.
   */
  private static manifestStatuses(path: string): AgentStatuses {
    const cached = AgentRenderer.manifestStatusCache.get(path);
    if (cached) return cached;

    const manifest = SessionStore.readManifest(path);
    const statuses: AgentStatuses = manifest
      ? {
          inheritContext: manifest.inheritContext,
          interactive: manifest.lifecycle === "interactive",
        }
      : {};

    AgentRenderer.manifestStatusCache.set(path, statuses);

    return statuses;
  }

  /**
   * Renders the Agent call header with source text for transcript composition.
   */
  private static renderCall(
    args: unknown,
    theme: Theme,
    context: unknown,
  ): Text {
    const renderContext = context as
      | { isError?: boolean; isPartial?: boolean }
      | undefined;
    const statusColor = renderContext?.isError ? "error" : "success";
    const statusGlyph = "●";

    return new ToolCallText(
      `${theme.fg(statusColor, statusGlyph)} ${theme.fg("toolTitle", theme.bold("Agent"))} ${theme.fg("accent", AgentRenderer.summary(args))}`,
    );
  }

  /**
   * Renders the same Agent error body in collapsed and expanded modes.
   */
  private static renderError(
    result: unknown,
    _options: unknown,
    theme: Theme,
  ): Text {
    const message = AgentRenderer.textContent(result).trim() || "Agent failed.";
    const lines = message.split("\n").map((line) => theme.fg("error", line));

    return new Text(AgentRenderer.branchText(lines, theme), 0, 0);
  }

  /**
   * Renders settled Agent output in collapsed or expanded form.
   */
  private static renderResult(
    result: unknown,
    options: unknown,
    theme: Theme,
    context: unknown,
  ): Text {
    const renderOptions = options as { expanded?: boolean } | undefined;
    const renderContext = context as { args?: unknown } | undefined;
    const args = renderContext?.args;
    const path = AgentRenderer.sessionPath(result, args);

    if (!path) {
      return new Text(
        AgentRenderer.branchText(
          [AgentRenderer.textContent(result).trim() || "Done"],
          theme,
        ),
        0,
        0,
      );
    }

    if (renderOptions?.expanded) {
      return new Text(
        AgentRenderer.dimBranchText(
          AgentRenderer.expandedResultLines(
            args,
            path,
            AgentRenderer.stringArg(args, "prompt") ?? "",
          ),
          theme,
        ),
        0,
        0,
      );
    }

    const statuses = AgentRenderer.collapsedStatuses(args, path).map((label) =>
      label === "inherited"
        ? theme.fg("success", "⧉ inherited")
        : theme.fg("mdHeading", "⌨ interactive"),
    );
    const status = statuses.length
      ? `${statuses.join(theme.fg("dim", " · "))}${theme.fg("dim", " • ")}`
      : "";

    return new Text(
      AgentRenderer.branchText(
        [`${status}${keyHint("app.tools.expand", "to expand")}`],
        theme,
      ),
      0,
      0,
    );
  }

  /**
   * Extracts the managed session path from a result, resume, or text fallback.
   */
  private static sessionPath(
    result: unknown,
    args: unknown,
  ): string | undefined {
    if (typeof result === "object" && result !== null) {
      const details = (result as { details?: unknown }).details;

      if (typeof details === "object" && details !== null) {
        const path = (details as { sessionPath?: unknown }).sessionPath;
        if (typeof path === "string" && path.length > 0) return path;
      }
    }

    const resumed = AgentRenderer.stringArg(args, "resume");
    if (resumed) return resumed;

    return AgentRenderer.textContent(result).match(
      /Session:\s*([^\n]+session\.jsonl)/,
    )?.[1];
  }

  /**
   * Extracts text blocks from one tool result.
   */
  private static textContent(result: unknown): string {
    if (typeof result !== "object" || result === null) return "";

    const content = (result as { content?: unknown }).content;
    if (!Array.isArray(content)) return "";

    return content
      .filter(
        (block): block is { type: "text"; text: string } =>
          typeof block === "object" &&
          block !== null &&
          (block as { type?: unknown }).type === "text" &&
          typeof (block as { text?: unknown }).text === "string",
      )
      .map((block) => block.text)
      .join("\n");
  }

  /**
   * Formats a result body under one branch marker.
   */
  private static branchText(lines: readonly string[], theme: Theme): string {
    const [first = "", ...rest] = lines;

    return [
      `${theme.fg("dim", "└")} ${first}`,
      ...rest.map((line) => `  ${line}`),
    ].join("\n");
  }

  /**
   * Formats a dim expanded result body under one branch marker.
   */
  private static dimBranchText(lines: readonly string[], theme: Theme): string {
    const [first = "", ...rest] = lines;

    return [
      `${theme.fg("dim", "└")} ${theme.fg("dim", first)}`,
      ...rest.map((line) => `  ${theme.fg("dim", line)}`),
    ].join("\n");
  }

  /**
   * Reads a non-empty string argument.
   */
  private static stringArg(args: unknown, key: string): string | undefined {
    if (typeof args !== "object" || args === null) return undefined;

    const value = (args as Record<string, unknown>)[key];

    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  /**
   * Reads a present boolean argument.
   */
  private static booleanArg(args: unknown, key: string): boolean | undefined {
    if (!AgentRenderer.hasOwn(args, key)) return undefined;

    const value = (args as Record<string, unknown>)[key];

    return typeof value === "boolean" ? value : undefined;
  }

  /**
   * Reports whether an object owns one argument key.
   */
  private static hasOwn(value: unknown, key: string): boolean {
    return (
      typeof value === "object" &&
      value !== null &&
      Object.prototype.hasOwnProperty.call(value, key)
    );
  }

  /**
   * Formats an optional boolean for expanded output.
   */
  private static statusValue(value: boolean | undefined): string {
    return value === undefined ? "?" : String(value);
  }
}
