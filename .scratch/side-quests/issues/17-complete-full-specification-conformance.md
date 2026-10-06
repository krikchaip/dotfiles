# 17: Complete full specification conformance

Type: task

**Status:** ready-for-human

**What to build:** Deliver the fully integrated Side Quests product. Audit every requirement against the specification, wayfinder map and resolved tickets, README, and executable layout oracle. Implement every remaining authorized gap instead of deferring it, then produce complete automated and real Pi-in-tmux acceptance evidence. Ticket 19's implementation gate is cleared; its remaining acceptance evidence is still required. The current approved fix pass is limited to the Ticket 13 family.

**Blocked by:** 16. Survive reload, replacement, and owner loss; 18. Layer project Agent definitions over global definitions; remaining Ticket 19 acceptance evidence.

- [ ] Build a traceable acceptance matrix covering every user story, implementation decision, testing decision, README behavior, and wayfinder amendment.
- [ ] Exercise every public `Agent` schema rule, agent-definition rule, permission invariant, lifecycle transition, mailbox state, terminal outcome, health transition, layout mode, UI state, reload path, teardown path, and storage-safety rule.
- [ ] Implement any missing behavior or evidence found by the audit; do not convert gaps into follow-up tickets or defer specified work.
- [ ] Inspect real normal-width and narrow-width screenshots for exact borders, padding, aligned columns, truncation, wrapping, selection, key hints, reply state, stale rows, and result expansion.
- [ ] Run formatter, typecheck, lint, unit tests, integration tests, prototype checks, package application checks, and isolated real Pi-in-tmux E2E tests with no failure or flake.
- [ ] Prove there is no focus theft, duplicate delivery, stale response, stale widget, leaked process, malformed geometry, unsafe resume, session-list pollution, or mutation of unrelated panes.
- [ ] Leave the specification, map amendments, resolved design tickets, README, package behavior, and test evidence consistent with each other.

**Shared context and history:** [Issue index](../index.md), including [comments](../index.md#comments).
