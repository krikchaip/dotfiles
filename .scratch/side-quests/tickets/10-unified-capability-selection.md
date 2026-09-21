# Unified Agent Capability Selection

Type: grilling
Status: resolved
Blocked by: 03, 09

Domain terms follow [`CONTEXT.md`](../../../home/dot_pi/agent/CONTEXT.md): Agent capability selection, Fixed capability selection, Parent-relative capability selection, and Direct extension baseline.

## Question

How should one consistent frontmatter language select a sub-agent's tools, extensions, lazy skills, and preloaded skills without separate denylist or preload fields?

## Answer

### Three fields

Consume only these capability fields:

- `tools`
- `extensions`
- `skills`

Do not recognize former capability field spellings such as `disallowed_tools`, `disallowed_extensions`, `available_skills`, or `preload_skills`. They receive no alias, migration warning, validation, or other backward-compatible handling. Silently ignore them under the same unknown-frontmatter rule as any field Side Quests does not consume.

### Shared value forms

Each capability field accepts:

```yaml
field: true
field: false
field: identifier, identifier
field: [identifier, identifier]
field:
  - identifier
  - identifier
```

Omission inherits the corresponding parent selection. `true` selects the broad field-specific set defined below. `false` selects none, except that `extensions: false` retains the Direct extension baseline. An explicit empty list has the same capability result as `false`.

CSV strings and YAML lists normalize identically. Trim boundary whitespace from every item independently, including uneven spaces around CSV separators:

```yaml
tools: "read,   +web_search , -bash"
```

normalizes to `read`, `+web_search`, and `-bash`. Preserve case and internal characters. Reject an item that is empty after trimming and reject every non-string list item.

A comma inside an identifier cannot be represented in CSV form because the comma is always a separator. Use a quoted YAML-list item instead:

```yaml
extensions:
  - "/tmp/extensions/a,b/index.ts"
```

Reject every repeated normalized entry as a duplicate syntax error; do not deduplicate it.

### Fixed and parent-relative selection

A list of plain identifiers is a Fixed capability selection:

```yaml
tools: [read, bash, web_search]
```

A list of `+identifier` and `-identifier` entries is a Parent-relative capability selection. It begins with the corresponding parent set, adds `+identifier`, and removes `-identifier`:

```yaml
tools: [+web_search, -bash]
```

Do not mix plain identifiers with `+` or `-` identifiers, even when their names differ:

```yaml
tools: [read, bash, +web_search] # malformed
```

The same normalized identifier cannot receive conflicting operations. Exact duplicate entries are also malformed. For extensions, detect duplicates and conflicts after Pi package/path identity normalization, so different versions, refs, or source spellings of one identity cannot bypass validation. Identity normalization does not discard the selected source version or ref; Pi resolves that exact source. A fixed expression cannot select two versions or refs of one identity. In Parent-relative capability selection, `+source` is an upsert by normalized identity: it adds an absent identity or replaces the inherited source for that identity with the exact requested version or ref. Multiple operations for that identity inside one expression remain duplicate or conflict errors. Identifiers remain case-sensitive. Unknown identifiers abort launch. Validate them before pane or session creation when the required registry is available. A tool supplied only by a newly selected child extension uses the child readiness path below and removes all temporary launch state on failure.

### Tools

`tools: true` selects all registered child tools. `tools: false` and `tools: []` select no normal child tools. A plain list selects the exact normal tool set. A signed list modifies the parent's current enabled set. Plain and `+` tool identifiers can explicitly enable a registered tool that is inactive in the parent.

Permanent Side Quests safety rules apply after selection. Subagent-spawning tools remain denied. Required child control tools remain outside Agent capability selection.

### Extensions

An extension identifier uses a source or path form Pi supports, including npm sources, Git sources, relative local paths, absolute local paths, directories, and Pi-supported path patterns. Use Pi's package identity rules: npm versions and Git refs do not change identity, while local identity uses a resolved absolute path. The source still retains and resolves an exact npm version or Git ref, for example `npm:@scope/package@1.2.3` or `git:github.com/user/repository@v2.0.0`. Relative paths resolve from the configuration scope of the Agent definition layer: global from `$PI_CODING_AGENT_DIR`, and project from `<cwd>/.pi`. `+` and `-` are the only Agent capability selection operators; do not add `!` as another removal alias.

Reuse Pi's package/source resolver and path-pattern behavior. Side Quests must not implement a second package parser, glob parser, or extension discovery algorithm.

The Direct extension baseline contains non-package extensions. Its source depends on selection mode:

- Omitted `extensions` inherits the complete parent extension snapshot unchanged, including direct extensions supplied to that parent through one-off `--extension` or `-e` CLI arguments.
- `true`, `false`, `[]`, and a Fixed capability selection use fresh normal child discovery for the Direct extension baseline. This includes current effective global/project direct extensions. It does not replay one-off `--extension` or `-e` sources from the parent process unless the fixed expression explicitly selects the same source.
- A Parent-relative capability selection starts from the complete parent extension snapshot, including its direct and package extensions and one-off parent CLI sources, then applies `+` and `-` operations.

Fixed extension selection replaces package extensions but retains the freshly discovered Direct extension baseline:

```yaml
extensions: [npm:pi-web-access]
```

loads that baseline plus extension entrypoints from `npm:pi-web-access`.

`extensions: false` and `extensions: []` load only the freshly discovered Direct extension baseline. `extensions: true` loads that baseline plus all package extensions that a normal new Pi child session would enable from its current effective settings. This differs from omission when the parent started with a reduced package-extension set, when settings changed after parent startup, or when the parent received a one-off CLI extension.

Only `-identifier` can remove a named member of the Direct extension baseline in Parent-relative capability selection. A plain or `+` identifier explicitly loads that extension even when parent or package settings disable it. Broad `true` respects normal Pi enablement and package filters.

Pi package references select packages as units. A selected package contributes its extension entrypoints, not its skills, prompts, or themes. Explicit plain or `+` package selection ignores extension filters from `settings.json` and loads the extension surface declared by the package. It still respects the package author's own `package.json` Pi manifest boundary and does not invent undeclared package resources. The required private Side Quests child companion is infrastructure outside Agent capability selection and cannot be removed.

### Skills

A plain skill identifier selects that skill for the lazy catalog. `+skill` adds a lazy skill to the inherited catalog. `-skill` removes a lazy skill. An explicit lazy-skill identifier can select a discovered skill that is normally hidden from model invocation.

`++skill` preloads the full skill instructions. It is mode-neutral:

- Plain identifiers plus `++skill` use Fixed capability selection.
- `+skill` or `-skill` plus `++skill` use Parent-relative capability selection.
- A list containing only `++skill` entries uses Fixed capability selection, has no lazy skills, and preloads those skills.

Examples:

```yaml
skills: [research, ++agent-browser]
skills: [+research, -grilling, ++tdd]
skills: [++tdd]
```

Do not mix a plain skill identifier with any single-signed identifier:

```yaml
skills: [tdd, +research, ++agent-browser] # malformed
```

A skill cannot be selected for the lazy catalog and preloaded at the same time. Thus `tdd, ++tdd` and `+tdd, ++tdd` are malformed. `-tdd, ++tdd` is valid: it removes a lazy copy and preloads the skill. Preloaded skills are absent from the resulting lazy catalog.

`skills: true` selects all normally model-invocable discovered skills for the lazy catalog and preloads none. `skills: false` and `skills: []` select no lazy or preloaded skills.

### Agent definition overlay

A project capability field replaces the complete same-name global field before capability resolution. A project signed expression resolves against the parent runtime, not against the global expression. Project omission still inherits the global field.

### Child readiness validation

A tool identifier can refer to a tool registered only by an extension selected for that child. When the parent registry cannot validate such a tool, start the detached child, load its resolved extensions, and validate against the resulting child tool registry before reporting launch success. The child must publish an explicit ready or failed result. If any intended extension entrypoint fails to load, or if child-registry validation fails, fail closed: remove the temporary pane, session, and manifest and return a launch error containing the relevant path and reason. Do not continue with a partial extension set. Do not execute extension code twice in a separate preflight process, and do not require the tool to exist in the parent registry.

### Test obligations

Every behavior requires automated evidence before implementation is accepted:

- `capability-selection-matrix`: table-driven unit tests cover all three fields, both list modes, booleans, omission, empty lists, whitespace normalization, comma-bearing YAML items, duplicate and conflict errors, overlay replacement, and unknown identifiers.
- `agent-tools-unified-selection`: E2E tests observe fixed, parent-relative, all, and empty child tool surfaces plus permanent Side Quests safety rules.
- `agent-skills-unified-selection`: E2E tests observe lazy and preloaded prompt content, fixed and parent-relative `++` behavior, hidden-skill selection, same-skill conflicts, missing-`read` behavior, and immutable resume policy.
- `agent-extensions-unified-selection`: E2E tests observe parent-snapshot inheritance, fresh child discovery, the Direct extension baseline, fixed and signed package/path selection, exact npm-version and Git-ref resolution, parent-relative version/ref upsert, same-identity duplicate/conflict rejection, settings-filter override, manifest boundaries, no-match errors, canonical identity conflicts, and comma-bearing paths. Prove omission and parent-relative selection retain a one-off parent CLI extension while `true`, `false`, `[]`, and a fixed list do not replay it unless explicitly selected.
- `agent-child-readiness`: E2E tests enable an extension unavailable in the parent, select one of its tools, and prove success only after child registry validation. Failure cases prove fail-closed cleanup with no retained pane, session, or manifest.
- `agent-capability-unknown-fields`: E2E tests prove former capability field spellings and unrelated unknown frontmatter are both ignored without a warning or capability effect.

Run focused tests during implementation. Finish with the package's clean serial release gate. Do not change production code until the user clears the implementation gate.

## Comments

- This ticket supersedes Ticket 3's `tools`/`disallowed_tools` and `available_skills`/`preload_skills` capability syntax. It also replaces Ticket 3's unconditional extension inheritance with resolved `extensions` policy.
- Uneven CSV separator spacing is accepted because each item is trimmed independently.
- Paths containing commas must use quoted YAML-list items; CSV cannot escape a comma.
- Every explicit extension identifier or pattern must resolve to at least one extension entrypoint. A package with no extensions, an empty extension directory, an unmatched pattern, and a removal with no match are launch errors. Broad `true`, `false`, and `[]` remain valid when no package extension exists.
- Fresh extension modes do not inherit one-off parent CLI sources. Omission and Parent-relative capability selection retain them through the parent snapshot.
