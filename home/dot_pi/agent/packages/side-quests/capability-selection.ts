/**
 * Identifies one Agent capability field with unified selection syntax.
 */
export type CapabilityField = "tools" | "extensions" | "skills";

/**
 * Identifies one action within a fixed or parent-relative selection.
 */
export type CapabilityEntry = Readonly<{
  /** States whether this entry adds, removes, or preloads a capability. */
  kind: "include" | "exclude" | "preload";

  /** Stores the normalized capability identifier. */
  name: string;
}>;

/**
 * Records an explicit replacement selection.
 */
export type FixedCapabilitySelection = Readonly<{
  /** Distinguishes this selection from boolean and parent-relative forms. */
  kind: "fixed";

  /** Lists the selected identifiers in source order. */
  entries: readonly CapabilityEntry[];
}>;

/**
 * Records an update to the parent capability snapshot.
 */
export type ParentRelativeCapabilitySelection = Readonly<{
  /** Distinguishes this selection from boolean and fixed forms. */
  kind: "parent-relative";

  /** Lists the requested operations in source order. */
  entries: readonly CapabilityEntry[];
}>;

/**
 * Records one parsed Agent capability selection.
 */
export type CapabilitySelection =
  | FixedCapabilitySelection
  | ParentRelativeCapabilitySelection
  | Readonly<{ kind: "all" }>
  | Readonly<{ kind: "none" }>;

/**
 * Keeps operator-origin metadata while the parser validates an expression.
 */
type ParsedEntry = Readonly<{
  entry: CapabilityEntry;
  parentRelative: boolean;
}>;

/**
 * Parses one present capability value into a normalized selection.
 */
export function parseCapabilitySelection(
  field: CapabilityField,
  value: unknown,
): CapabilitySelection {
  if (value === true) return { kind: "all" };
  if (value === false) return { kind: "none" };

  const parsed = normalizeEntries(field, value);
  if (!parsed.length) return { kind: "none" };
  validateEntries(field, parsed);

  return {
    entries: parsed.map(({ entry }) => entry),
    kind: selectionKind(parsed),
  };
}

/**
 * Splits CSV values or preserves YAML-list values before parsing entries.
 */
function normalizeEntries(
  field: CapabilityField,
  value: unknown,
): ParsedEntry[] {
  const rawValues = typeof value === "string" ? value.split(",") : value;

  if (!Array.isArray(rawValues))
    throw new Error(`${field} must be a boolean, CSV string, or string list`);

  return rawValues.map((value) => parseEntry(field, value));
}

/**
 * Parses one normalized identifier and its optional selection operator.
 */
function parseEntry(field: CapabilityField, value: unknown): ParsedEntry {
  if (typeof value !== "string")
    throw new Error(`${field} entries must be strings`);

  const source = value.trim();
  if (!source) throw new Error(`${field} entries must not be empty`);

  if (source.startsWith("++")) {
    if (field !== "skills")
      throw new Error(`${field} does not support the ++ preload operator`);
    return {
      entry: capabilityEntry("preload", source.slice(2), field),
      parentRelative: false,
    };
  }

  if (source.startsWith("+"))
    return {
      entry: capabilityEntry("include", source.slice(1), field),
      parentRelative: true,
    };
  if (source.startsWith("-"))
    return {
      entry: capabilityEntry("exclude", source.slice(1), field),
      parentRelative: true,
    };
  return {
    entry: capabilityEntry("include", source, field),
    parentRelative: false,
  };
}

/**
 * Creates an entry after checking that its identifier is non-empty.
 */
function capabilityEntry(
  kind: CapabilityEntry["kind"],
  name: string,
  field: CapabilityField,
): CapabilityEntry {
  if (!name) throw new Error(`${field} entries must name a capability`);
  return { kind, name };
}

/**
 * Rejects duplicate, conflicting, and mixed fixed/relative expressions.
 */
function validateEntries(
  field: CapabilityField,
  entries: readonly ParsedEntry[],
): void {
  const exactEntries = new Set<string>();
  const entriesByName = new Map<string, Set<CapabilityEntry["kind"]>>();
  const hasFixedInclude = entries.some(
    ({ entry, parentRelative }) => entry.kind === "include" && !parentRelative,
  );
  const hasRelativeOperation = entries.some(
    ({ parentRelative }) => parentRelative,
  );

  for (const { entry } of entries) {
    const key = `${entry.kind}:${entry.name}`;
    if (exactEntries.has(key))
      throw new Error(`${field} entries must not contain duplicates`);
    exactEntries.add(key);

    const kinds = entriesByName.get(entry.name) ?? new Set();
    kinds.add(entry.kind);
    entriesByName.set(entry.name, kinds);
  }

  if (hasFixedInclude && hasRelativeOperation)
    throw new Error(`${field} cannot mix fixed and parent-relative entries`);

  for (const [name, kinds] of entriesByName) {
    if (kinds.has("include") && kinds.has("exclude"))
      throw new Error(`${field} has conflicting operations for ${name}`);
    if (kinds.has("include") && kinds.has("preload"))
      throw new Error(`${field} cannot lazily select and preload ${name}`);
  }
}

/**
 * Determines whether the expression replaces or modifies the parent snapshot.
 */
function selectionKind(
  entries: readonly ParsedEntry[],
): "fixed" | "parent-relative" {
  return entries.some(({ parentRelative }) => parentRelative)
    ? "parent-relative"
    : "fixed";
}

/**
 * Resolves a named Fixed or Parent-relative capability selection.
 *
 * The identity callback defaults to exact identifiers. Extension callers can
 * supply Pi-derived package or path identity normalization without coupling
 * this grammar module to Pi internals.
 */
export function resolveCapabilitySelection(
  selection: FixedCapabilitySelection | ParentRelativeCapabilitySelection,
  parent: readonly string[],
  identity: (name: string) => string = (name) => name,
): readonly string[] {
  const entries = selection.entries.filter(({ kind }) => kind !== "preload");
  validateResolvedIdentities(entries, identity);

  const selected = selection.kind === "fixed" ? [] : [...parent];
  for (const entry of entries) {
    const entryIdentity = identity(entry.name);
    const index = selected.findIndex(
      (name) => identity(name) === entryIdentity,
    );

    if (entry.kind === "include") {
      if (index < 0) selected.push(entry.name);
      else selected.splice(index, 1, entry.name);
      continue;
    }

    if (index < 0)
      throw new Error(`capability selection cannot remove ${entry.name}`);
    selected.splice(index, 1);
  }

  return selected;
}

/**
 * Rejects source spellings that resolve to the same external identity.
 */
function validateResolvedIdentities(
  entries: readonly CapabilityEntry[],
  identity: (name: string) => string,
): void {
  const kindsByIdentity = new Map<string, CapabilityEntry["kind"]>();

  for (const entry of entries) {
    const key = identity(entry.name);
    const previous = kindsByIdentity.get(key);
    if (previous)
      throw new Error(
        previous === entry.kind
          ? `capability selection repeats ${entry.name}`
          : `capability selection conflicts on ${entry.name}`,
      );
    kindsByIdentity.set(key, entry.kind);
  }
}
