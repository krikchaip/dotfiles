# Autonomous Orchestrator Prompt Redesign

Label: wayfinder:map

## Destination

An implementation-ready redesign for Pi Subagents Orchestrator On/Off prompting and runtime-only control-tool unlocking, including exact prompt contracts, source-change boundaries, documentation changes, and unit/static verification coverage.

## Notes

- Domain: Pi Subagents extension at `/Users/asol/.pi/agent/git/github.com/krikchaip/pi-subagents`.
- Consult Pi extension documentation and the `codebase-design` skill where useful.
- Planning only. Do not implement extension changes while resolving this map.
- Use simple English and include concrete workflow examples in prompt designs.
- Orchestrator Off remains compact but may still delegate autonomously.
- Orchestrator On performs a delegation check before substantial direct work and manages suitable multi-phase workflows through completion.
- Foreground agents are preferred. Multiple foreground calls in one assistant message form a blocking parallel phase.
- Background agents are reserved for specific cases such as CRON, scheduled jobs, recurring loops, monitoring, or independent long-running work not needed yet.
- Every foreground/background assignment must have non-overlapping ownership. Main agent must not duplicate active subagent work.
- Same worktree is default. Prefer one writer for a coherent change; concurrent write scopes must not overlap. Ask user before isolated worktrees when safe partitioning is not possible.
- Fresh context is default in On mode; use inherited context only when important conversation history is needed. Include examples.
- If no specialist fits exactly, route substantial suitable work to a broad capable agent without duplicating its description.
- After first successful `Agent` spawn, expose `get_subagent_result` and `steer_subagent` for current in-memory runtime only. Reload/session replacement resets exposure.
- Orchestrator prompt and turn reminder are the sole orchestration-policy sources.
- Do not modify `Agent` tool description or parameter descriptions.
- User owns E2E testing.

## Decisions so far

- [Mode-Specific Prompt Contracts](tickets/01-draft-mode-specific-prompt-contracts.md): use the exact accepted Off, On, and initial-turn reminder bodies in [Consolidated Prompt Contracts](prototypes/04-consolidated-prompt-contracts.md); preserve their fixed list placeholders and leave `Agent` tool/parameter descriptions unchanged.
- [Runtime-Only Control-Tool Unlocking](tickets/02-design-runtime-control-tool-unlocking.md): use a local `index.ts` active-tool gate—lock controls on fresh runtime, unlock after a successful new spawn, and preserve unrelated active tools without persistence.
- [Verification and Documentation Contract](tickets/03-define-verification-and-documentation-contract.md): use exact static prompt contracts, lifecycle wiring tests, and active-tool gate tests; document only high-level mode behavior and staged runtime exposure, with no E2E or tool-schema work.

## Not yet specified

<!-- No remaining in-scope fog. -->

## Out of scope

- E2E testing and model-behavior evaluation; user will perform these.
- Changes to `Agent` tool description or parameter descriptions.
- Building a dedicated chain/workflow tool comparable to nicobailon's implementation.
- Replacing this extension with nicobailon's package.
