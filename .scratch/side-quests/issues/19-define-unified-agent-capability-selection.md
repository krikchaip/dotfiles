# 19: Define unified Agent capability selection

Type: task

**Status:** done

**Implementation gate:** Cleared by the user via `/skill:implement`. Production integration has started. The `done` status above refers to design; it does not accept the remaining Ticket 19 implementation matrix.

**What to build:** Replace separate tool denylist, skill selection, skill preload, and extension-inheritance rules with one Agent capability selection surface: `tools`, `extensions`, and `skills`. The design uses Fixed capability selection and Parent-relative capability selection. It preserves the Direct extension baseline and adds strict child readiness validation.

**Blocked by:** 13. Configure general-purpose and named agents; 18. Layer project Agent definitions over global definitions.

- [x] Define the shared boolean, CSV, YAML-list, whitespace, duplicate, and conflict rules.
- [x] Define fixed and parent-relative tool, extension, and skill selection.
- [x] Define `++skill` preload behavior and prevent lazy/preloaded duplication.
- [x] Define package identity, exact npm-version and Git-ref resolution, parent-relative source upsert, direct-extension baseline, fresh child discovery, and Pi resolver reuse.
- [x] Define fail-closed selection and child readiness behavior for extension-provided tools.
- [x] Define no backward compatibility for former capability field spellings: consume only `tools`, `extensions`, and `skills`, and silently ignore every other unrecognized frontmatter field.
- [x] Record the design in [Unified Agent Capability Selection](10-unified-capability-selection.md). This checked item records the design-only amendment; authorized production work started afterward.

**Shared context and history:** [Issue index](../index.md), including [comments](../index.md#comments).
