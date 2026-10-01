import {
  type CapabilitySelection,
  resolveCapabilitySelection,
} from "./capability-selection.ts";

/**
 * Lists spawning tools denied in every child, including broad discovery.
 */
export const DENIED_SPAWNING_TOOLS = [
  "Agent",
  "Task",
  "delegate",
  "spawn_agent",
  "subagent",
] as const;

/**
 * Lists parent-only or child-infrastructure tools excluded from Agent policy.
 */
const UNSELECTABLE_TOOLS = new Set<string>([
  ...DENIED_SPAWNING_TOOLS,
  "ask_parent",
  "subagent_done",
]);

/**
 * Supplies the live parent and registered tool snapshots.
 */
export type ToolCapabilitySnapshot = Readonly<{
  /** Lists the parent's currently active tools. */
  active: readonly string[];

  /** Lists all tools registered in the parent process. */
  registered: readonly string[];
}>;

/**
 * Supplies one discovered skill's selection metadata.
 */
export type DiscoveredSkillCapability = Readonly<{
  /** Identifies the exact case-sensitive skill. */
  name: string;

  /** Reports whether broad selection can expose the skill lazily. */
  modelInvocable: boolean;
}>;

/**
 * Supplies discovered skills and the parent's current lazy catalog.
 */
export type SkillCapabilitySnapshot = Readonly<{
  /** Lists every skill available for explicit selection or preload. */
  discovered: readonly DiscoveredSkillCapability[];

  /** Lists the parent's current lazy skill catalog. */
  parent: readonly string[];
}>;

/**
 * Records the resolved lazy and preloaded skill names.
 */
export type ResolvedSkillCapabilities = Readonly<{
  /** Lists exact skills exposed through Pi's lazy catalog. */
  lazy: readonly string[];

  /** Lists exact skills injected into the child system prompt. */
  preloaded: readonly string[];
}>;

/**
 * Resolves one tool expression and applies permanent Side Quests safety rules.
 */
export function resolveToolCapabilities(
  selection: CapabilitySelection | undefined,
  snapshot: ToolCapabilitySnapshot,
  options: Readonly<{ deferUnknown?: boolean }> = {},
): readonly string[] {
  const active = selectableTools(snapshot.active);
  const registered = selectableTools(snapshot.registered);

  if (!selection) return active;
  if (selection.kind === "all") return registered;
  if (selection.kind === "none") return [];

  if (!options.deferUnknown) {
    const known = new Set(snapshot.registered);
    for (const entry of selection.entries)
      if (!known.has(entry.name) && !UNSELECTABLE_TOOLS.has(entry.name))
        throw new Error(`Unknown child tool: ${entry.name}`);
  }

  return selectableTools(
    resolveCapabilitySelection(selection, active).filter((name) =>
      options.deferUnknown || snapshot.registered.includes(name)
        ? true
        : UNSELECTABLE_TOOLS.has(name),
    ),
  );
}

/**
 * Resolves one skill expression against discovered and parent skill snapshots.
 */
export function resolveSkillCapabilities(
  selection: CapabilitySelection | undefined,
  snapshot: SkillCapabilitySnapshot,
): ResolvedSkillCapabilities {
  if (!selection) return { lazy: [...snapshot.parent], preloaded: [] };
  if (selection.kind === "all")
    return {
      lazy: snapshot.discovered
        .filter(({ modelInvocable }) => modelInvocable)
        .map(({ name }) => name),
      preloaded: [],
    };
  if (selection.kind === "none") return { lazy: [], preloaded: [] };

  const known = new Set(snapshot.discovered.map(({ name }) => name));
  for (const entry of selection.entries)
    if (!known.has(entry.name))
      throw new Error(`Unknown child skill: ${entry.name}`);

  const preloaded = selection.entries
    .filter(({ kind }) => kind === "preload")
    .map(({ name }) => name);
  const lazy = resolveCapabilitySelection(selection, snapshot.parent).filter(
    (name) => !preloaded.includes(name),
  );

  return { lazy, preloaded };
}

/**
 * Removes infrastructure and nested-subagent tools while preserving order.
 */
function selectableTools(names: readonly string[]): readonly string[] {
  return names.filter((name) => !UNSELECTABLE_TOOLS.has(name));
}
