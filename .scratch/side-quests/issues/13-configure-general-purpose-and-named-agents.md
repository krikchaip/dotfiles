# 13: Configure general-purpose and named agents

Type: task

**Status:** done

**Implementation gate:** Cleared by the user before production changes.

**What to build:** Let users configure the standard general-purpose agent and any number of named agents through project and global Markdown definitions. Every launch starts from the current parent runtime and applies strict, validated overrides. The parent model receives a draft routing guideline and the valid agent catalog in Pi's `Guidelines` section, including `general-purpose` last when it supplies an agent selection description and at least one named entry exists. Every child's resolved capabilities remain fixed across continuation, takeover, reload, and reopen.

**Blocked by:** 12. Deliver the complete day-to-day MVP.

**Required discussion before Ticket 13 implementation:** Complete. Ticket 13 originally delivered whole-file project shadowing and tombstone validation short-circuiting. Ticket 18 and [Agent Definition Overlays](09-agent-definition-overlays.md) supersede those resolution rules with field-by-field overlay and strict validation of every supplied field. [Unified Agent Capability Selection](10-unified-capability-selection.md) supersedes Ticket 13 capability syntax and extension inheritance. Ticket 13's checked capability items are historical evidence for the earlier implementation, not the current required behavior. Its remaining parser, boundary, non-capability default, prompt assembly, catalog, and lifecycle decisions remain in force.

- [x] Record the agreed omission/null/empty-string/empty-list/body behavior for every supported frontmatter field before writing its resolver.
- [x] Make omitted `subagent_type` and explicit `general-purpose` resolve to the same reserved standard identity.
- [x] Without a winning `general-purpose.md`, use the unmodified parent clone.
- [x] Apply supported frontmatter and Markdown-body overrides from a valid winning project or global `general-purpose.md`; allow its `description` to be absent.
- [x] Make project general-purpose configuration shadow global configuration before validation.
- [x] Reject omitted and explicit general-purpose launches when the winning file is malformed, with one path-specific warning and no fallback.
- [x] Treat `enabled: false` in project or global general-purpose configuration as removal of customization, not removal of the standard agent; a project tombstone also shadows global customization.
- [x] Discover non-general-purpose agents from only the specified project and global scopes with exact case-sensitive stems, project precedence, fail-closed malformed shadowing, and disabling tombstones.
- [x] Make a named definition with only its required `description`, such as `security-review.md`, use the same parent-derived runtime baseline as uncustomized `general-purpose` while retaining its distinct named identity. Treat frontmatter `description` only as parent-agent selection guidance, not as sub-agent instructions; with no Markdown body, task behavior comes from `Agent.prompt`.
- [x] Put the draft routing guideline and every valid named agent's canonical name plus full whitespace-normalized description in separate contiguous bullets in the parent system prompt's `Guidelines` section. Add `general-purpose` last only when it supplies a description and at least one named entry exists; otherwise omit the complete catalog. Do not duplicate the catalog in the short tool description.
- [x] Refresh the registration-time enum after reload so it always contains `general-purpose` plus every valid enabled non-general-purpose name.
- [x] Resolve exact model, thinking, tool allowlist and denylist, lazy skills, preloaded skills, context, lifecycle, display name, and XML-wrapped body instructions from the parent baseline. Let only per-launch `Agent.inherit_context` and `Agent.interactive` override definition values, then apply permanent Side Quests safety rules.
- [x] Reject unknown models, tools, and skills before pane or session creation; clamp valid thinking levels through Pi's native behavior.
- [x] Permanently hard-deny spawning tools, force-enable `ask_parent`, and preserve resolved identity, context choice, lifecycle, capabilities, and prompt policy across resume. Reject `subagent_type`, `inherit_context`, and `interactive` on resume; only accepted direct terminal input can promote lifecycle after creation.
- [x] Add table-driven policy tests for every supported field covering omission, YAML null, empty string, valid empty collection where applicable, valid value, and invalid type for both `general-purpose` and named definitions. Use Pi's frontmatter parser and cover duplicate YAML keys, required boundaries, tombstone short-circuiting, CSV/list equivalence, first-occurrence deduplication, invalid collection entries, and absent or empty bodies.
- [x] E2E-demo a description-only named definition and prove that omitted runtime fields inherit the parent-derived baseline while the distinct identity and catalog description remain.
- [x] E2E-demo a valid `general-purpose.md` with an explicit empty frontmatter block and an absent or empty Markdown body; prove project shadowing, no-op parent cloning, no body XML element, and both omitted and explicit `general-purpose` launches.
- [x] E2E-demo CSV-string, YAML-list, and explicit-empty behavior for `tools`, `disallowed_tools`, `available_skills`, and `preload_skills`, observing the actual child prompt and tool surface rather than only parsed values.
- [x] E2E-demo representative YAML-null and empty-string failures for both general-purpose and named winning files. Prove one path-specific warning, no pane or session creation, no fallback to a shadowed global definition or plain parent clone, and rejection of both omitted and explicit general-purpose launches when applicable.
- [x] E2E-demo project-over-global behavior, `enabled: false` customization removal and named tombstones, a named restricted reviewer, draft Guidelines routing/catalog refresh including conditional general-purpose guidance last, child body instructions as the only XML content, immutable permissions after resume, and all final behaviors agreed during the frontmatter discussion.

**Shared context and history:** [Issue index](../index.md), including [comments](../index.md#comments).
