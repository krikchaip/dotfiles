# Draft Mode-Specific Prompt Contracts

Type: prototype
Status: resolved
Blocked by:

## Question

What exact responsibilities, rules, examples, dynamic agent-list form, and token-conscious wording belong in `delegation.md`, `orchestrator.md`, and `orchestrator-reminder.md` so Off stays compact while On reliably teaches manual multi-phase orchestration without duplicating tool/parameter descriptions?

## Comments

- Prototype: [Mode-Specific Prompt Contracts](../prototypes/01-mode-specific-prompt-contracts.md) — rejected; supersede after source-led redesign.
- Human feedback: do not alter `Agent` tool or parameter descriptions; this ticket changes only the three Markdown prompt files. `delegation.md` and `orchestrator-reminder.md` use `{{compactTypeList}}`; `orchestrator.md` uses `{{structuredTypeList}}`; each template owns its fixed variable. `orchestrator.md` should be substantial: explain why and when, give decision rules and examples, and may mention parameters without duplicating their mechanical descriptions. Re-read nicobailon/pi-subagents README, bundled skill, and prompt templates before replacement variants.
- Replacement: [Source-Led Prompt Contracts](../prototypes/02-source-led-prompt-contracts.md) — rejected because the On contract was too skeletal.
- Iteration method: first align on lessons from the references; then present at least three variants of each prompt file and repeat selection/revision until accepted.
- Accepted after consolidated human review: [Consolidated Prompt Contracts](../prototypes/04-consolidated-prompt-contracts.md).

## Answer

Use the exact three prompt bodies in [Consolidated Prompt Contracts](../prototypes/04-consolidated-prompt-contracts.md):

- `delegation.md` uses the accepted compact Off contract and `{{compactTypeList}}`.
- `orchestrator.md` uses the accepted explanatory On contract and the bare `{{structuredTypeList}}`, whose expansion supplies its own `<available-subagents>` wrapper.
- `orchestrator-reminder.md` uses the accepted initial-turn summary and `{{compactTypeList}}`.

The linked prototype is the canonical exact wording; implementation must copy those fenced prompt bodies without changing `Agent` tool or parameter descriptions.
