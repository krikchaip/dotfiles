# Define Verification and Documentation Contract

Type: research
Status: resolved
Blocked by: 01, 02

## Question

What exact unit/static tests and README changes must prove and document the approved prompt contracts and runtime-only staged tool exposure, while excluding E2E testing and all tool/parameter-description changes?

## Answer

Change only these extension files:

- `prompts/delegation.md`, `prompts/orchestrator.md`, and `prompts/orchestrator-reminder.md`: copy the exact accepted bodies from [Consolidated Prompt Contracts](../prototypes/04-consolidated-prompt-contracts.md). Keep `{{compactTypeList}}` only in Off and reminder, and `{{structuredTypeList}}` only in On.
- `src/index.ts`: add the active-tool gate and successful-new-spawn unlock seams specified by [Runtime-Only Control-Tool Unlocking](02-design-runtime-control-tool-unlocking.md). Do not alter prompt injection, `Agent` description, or any tool/parameter description.
- `README.md`: replace the current Orchestrator Mode prose with a high-level user-facing mode description and links to the three bundled prompt files as the policy source. State: Off supplies compact delegation guidance and still permits autonomous delegation; On has the parent design, delegate, synthesize, and verify suitable multi-phase work; its hidden reminder occurs only for real user input and is not persisted; child append prompts exclude all three parent-only blocks. Do not duplicate the detailed policy from the prompts.
- `README.md`, before the `Agent` table: state that a fresh extension runtime exposes `Agent` only; first successful new foreground or background spawn unlocks `get_subagent_result` and `steer_subagent` for that runtime; scheduling, rejected spawns, and resume do not unlock them; extension reload or session replacement locks them again. This is runtime behavior, not a setting.

Add `test/orchestrator-prompt-contract.test.ts` with a hermetic extension harness. It must:

1. Read each shipped prompt and assert byte-for-byte equality (after one documented trailing-newline normalization) with the accepted contract text; this guards rules, workflow examples, and fixed placeholders.
2. Exercise `before_agent_start`: Off injects only rendered delegation; On injects only rendered orchestrator; parent-only blocks are stripped before either result; a subagent system prompt is never injected again.
3. Exercise `input` then `context`: On inserts one hidden `pi-subagents-orchestrator-reminder` immediately before a real final user message; it skips extension and steering input, non-user final messages, Off mode, and subagent prompts; handling the context event clears the pending reminder so it cannot recur without new real input.

Add `test/control-tool-unlocking.test.ts`, using the real extension registration with mocked `getActiveTools` and `setActiveTools`. It must prove:

1. Initial activation removes only `get_subagent_result` and `steer_subagent`, preserves unrelated active names, and ensures `Agent` remains active.
2. One successful background spawn unlocks both controls once, including a queued accepted spawn; duplicate successful spawns do not repeat the active-tool update.
3. One successful foreground spawn unlocks both controls from its synchronous `onSpawned` callback before session creation; duplicate foreground spawns remain idempotent.
4. A rejected/throwing spawn, schedule registration, and resume leave controls locked.
5. A fresh extension instance performs initial locking again and has no remembered unlock state.

Do not add or run E2E/model-behavior tests. Run the two new unit/static files, then `npm run lint` and `npm run typecheck`; user owns E2E execution.
