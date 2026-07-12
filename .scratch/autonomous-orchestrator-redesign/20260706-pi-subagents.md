## Dynamic system prompt (Metadata part show in pi-token-burden)

- [ ] what's different between having `Orchestrator` on vs off?
  - `off` :: human is the orchestrator. dedicated prompting paradigm. minimal description in system prompt required.
    - the human is the one who bears the cognitive load. remember how to delegate, subagents functionalities, and tool params.
    - prompt examples:
      - "Use `@reviewer` to review this diff."
      - "Run parallel `@reviewer`s: one for correctness, one for tests, and one for unnecessary complexity."
      - "Have `@worker` implement this approved plan, then run `@reviewer`s and apply the feedback."
    - ref: https://github.com/nicobailon/pi-subagents/blob/main/README.md
  - `on` :: agent is the orchestrator. **think and act like** an orchestrator. rich description in system prompt required.
    - translate user queries/intent into orchestrating actions before start delegating.
    - delegate almost all tasks to subagents (>90%). only do the tasks by itself under specific conditions. noticeably <10% of time.
      - "specific conditions" -> TBD.
    - ref: https://github.com/nicobailon/pi-subagents/blob/main/skills/pi-subagents/SKILL.md
- [ ] modify `/Users/asol/.pi/agent/git/github.com/krikchaip/pi-subagents/prompts/delegation.md`
  - make it minimal. since user will mostly ask the agent to spawn subagents by themself.
  - use {{compactTypeList}} in the prompt instead.
  - [ ] **decision**: should we move this back to the Guidelines section or keep it here?
    - if move back, then how do we handle with subagents definitions, since they are dynamic?
    - if move back, orchestrator.md content should be there too. so in the end, no dynamic section in system prompt anymore.
- [ ] modify `/Users/asol/.pi/agent/git/github.com/krikchaip/pi-subagents/prompts/orchestrator.md`
  - rich content. prose should successfully steer the agent into becoming an orchestrator.
  - elaborate each param/option of `Agent` tool. e.g.:
    - when should and should not use the `run_in_background: true`.
    - how to use the option effectively.
    - should focus on the 'why' and 'when' with examples
  - translate user queries/intent into orchestrating actions and act accordingly.
  - use {{structuredTypeList}} in the prompt. same.
- [ ] modify `/Users/asol/.pi/agent/git/github.com/krikchaip/pi-subagents/prompts/orchestrator-reminder.md`
  - keep the prompt small.
  - remind/encourage the agent to always delegate unless match specifc exceptions.
  - include {{compactTypeList}} in the reminder so the main agent knows which subagent to delegate for which part.
  - should tell the main agent to strictly not to delegate same/overlapping tasks to new agents, or even doing the overlapping tasks by its own.
    - session `019f35d9` is a counter-example.
    - especially when delegating tasks to background agents.
    - for delegating similar tasks, make sure they are not overlapping each other.
      - e.g. exploring a codebase. Agent A should search or work on a different area than Agent B, even both are doing similar.
    - the main agent MUST NOT do any of the work that subagents are already doing.
      - work on different areas if need to.

## Tools reveal after first `Agent` use

> After calling `Agent` the first time, expose `steer_subagent` and `get_subagent_result` to the agent. support both modes (Orchestrator on/off).
