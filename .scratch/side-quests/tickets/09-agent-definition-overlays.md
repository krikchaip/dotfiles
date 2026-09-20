# Agent Definition Overlays

Type: grilling
Status: resolved

Domain terms follow the [specification](../spec.md#domain-model). An Agent definition is one authored global or project file. Agent definition overlay combines same-name files field by field. The Resolved Agent definition is the validated result.

## Question

When both global and project scopes define the same sub-agent identity, does the project file replace the complete global definition, or can it override selected fields while inheriting the rest?

## Answer

Resolve same-name global and project Agent definitions field by field. The global definition is the lower-priority layer. The project definition is the higher-priority layer.

For every supported frontmatter field:

1. A field supplied by the project definition replaces the complete global field.
2. A field omitted by the project definition inherits the global field.
3. A field omitted by both definitions uses its documented default.

Collection fields are replaced, not concatenated or unioned. An explicit empty collection replaces the global collection with its documented empty selection. Scalar sentinels such as `tools: all` and `tools: none` keep their existing meanings. No reset sentinel is added: YAML null and empty scalar strings remain malformed. A project layer cannot bypass a supplied global scalar to restore the parent-derived default; it must supply another valid value. If both layers omit a parent-derived field such as `model`, the Resolved Agent definition inherits the current parent value.

Resolve the Markdown body separately but with the same precedence. A non-empty project body replaces the global body. A project body that is absent or whitespace-only after boundary trimming inherits the global body. If neither layer has a non-empty body, add no Agent definition instructions. This design adds no syntax for clearing a non-empty global body.

Parse and validate every present global and project file. Every supplied supported field must be valid even when the other layer overrides that field or the Resolved Agent definition has `enabled: false`. A valid higher-priority field cannot hide an invalid lower-priority field. Missing frontmatter boundaries, duplicate YAML keys, invalid supported values, and other existing malformed-file conditions invalidate the Resolved Agent definition. Unknown fields remain ignored for shared-file compatibility.

Apply required-field checks and defaults after overlay. A named Resolved Agent definition still requires a non-empty `description`; `general-purpose` still permits no description. Thus a project-only named definition containing only `model` is malformed, while a project definition containing only `model` is valid when the same-name global definition supplies a valid description.

`enabled` follows normal field precedence. A project `enabled: false` disables the resolved named identity or removes resolved general-purpose customization. A project `enabled: true` can restore a global definition whose global layer supplies `enabled: false`, while inheriting the global layer's other valid fields. If the project omits `enabled`, it inherits the global value; if both omit it, the documented default is `true`. Disabling does not skip parsing or validation in either layer.

An empty project frontmatter block supplies no frontmatter overrides. It inherits all supplied global frontmatter fields. When no global definition exists, documented frontmatter defaults apply. Resolve the Markdown body independently: a non-empty project body replaces the global body, while an absent or whitespace-only project body inherits it. A project definition with empty frontmatter and no resolved body produces the same plain general-purpose parent clone when no global definition exists. It does not erase a same-name global definition.

Reload resolves the current layers again for new launches. Existing child manifests remain immutable and continue to use their launch-time Resolved Agent definition.

## Test obligations

Every grilling answer requires automated evidence. Use focused unit tests for the complete resolution matrix and real Pi-in-tmux E2E scenarios for user-visible launch behavior. The E2E harness must observe the child prompt, tools, manifest, catalog, warning, pane, and session state relevant to each decision instead of asserting parser output alone.

| Answer | Required automated evidence |
| --- | --- |
| Q1 — collection replacement | `agent-overlay-replaces-collection-fields`: global and project collections differ; the launched child receives only the complete project value. Include an explicit project `[]` case. |
| Q2 — body inheritance | `agent-overlay-inherits-global-body`: an absent and a whitespace-only project body each preserve the global body. A non-empty project body replaces it and excludes the global body. |
| Q3 — strict participating-layer validation | `agent-overlay-rejects-overridden-invalid-global`: a valid project override of the same field does not hide an invalid global value; warning appears and no pane or session is created. |
| Q4 — `enabled` precedence | `agent-overlay-project-enabled-overrides-global`: project `true` restores global `false`; project `false` disables global `true`; project omission inherits the global value. |
| Q5 — post-overlay required description | `agent-overlay-validates-description-after-overlay`: project-only model without any description fails, while the same project layer succeeds when global supplies the named description. |
| Q6 — documented defaults after double omission | `agent-overlay-uses-parent-default-after-double-omission`: when both layers omit parent-derived fields, the child receives the current parent model, thinking, tools, and skills. Existing null and empty-string rejection remains covered. |
| Q7 — restored-layer field inheritance | `agent-overlay-restored-agent-inherits-global-fields`: project `enabled: true` over global `enabled: false` inherits the global layer's valid description, policy, and body. |
| Q8 — project tombstone does not hide malformed global | `agent-overlay-tombstone-validates-global`: project `enabled: false` plus malformed global configuration emits the global-path warning and does not silently resolve as a valid tombstone. |
| Q9 — disabled fields remain strict | `agent-overlay-validates-disabled-layer-fields`: malformed sibling fields beside `enabled: false` fail in both global and project layers. |

A clean serial release gate must include all overlay unit tests and all overlay E2E scenarios. No grilling answer is accepted based only on a written requirement.
