# 18: Layer project Agent definitions over global definitions

Type: task

**Status:** done

**What to build:** Replace whole-file project shadowing with strict Agent definition overlay. For the same canonical identity, supplied project fields replace complete global fields, omitted project fields inherit global fields, and fields omitted from both use documented defaults. Resolve Markdown instructions with the same precedence. Validate every present layer and every supplied supported field before launch.

**Blocked by:** 13. Configure general-purpose and named agents.

- [x] Implement field-presence-aware global-to-project overlay without merging collection elements.
- [x] Apply required named-description checks and documented defaults only after overlay.
- [x] Inherit a non-empty global body when the project body is absent or whitespace-only; replace it with a non-empty project body.
- [x] Make project `enabled` override global `enabled`, including restoration through project `true`, while validating every supplied field even when disabled or overridden.
- [x] Preserve strict malformed-layer rejection, unknown-field compatibility, reload behavior for new launches, and immutable existing child manifests.
- [x] Add the named unit and real Pi-in-tmux E2E evidence for Q1–Q9 recorded in [Agent Definition Overlays](09-agent-definition-overlays.md). Every grilling answer has corresponding automated evidence.
- [x] Run the clean serial release gate: format, lint, typecheck, 442 unit tests, all 94 serial real Pi-in-tmux E2E scenarios, diff check, and deployed-runtime comparison.

**Shared context and history:** [Issue index](../index.md), including [comments](../index.md#comments).
