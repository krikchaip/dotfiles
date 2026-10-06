# 11: Establish package architecture and verification loop

Type: task

**Status:** done

**What to build:** Establish a working local Pi package foundation with a small declarative composition root, cohesive deep modules, and an executable verification loop. Complete this ticket with the user in the loop: agree on module interfaces, ownership invariants, and test seams before those decisions are locked. The independently demoable product behavior is safe startup: outside tmux, Side Quests warns exactly once and remains fully inert; inside tmux, parent and child roles load only their intended package surfaces without startup errors.

**Blocked by:** None — can start immediately.

- [x] Agree with the user on the deep module interfaces for agent policy, persistent state and mailboxes, tmux ownership and layout, parent coordination and event delivery, parent UI, and child lifecycle and activity.
- [x] Keep the package entrypoint declarative and keep parsing, persistence, process control, layout, polling, and rendering inside their owning modules.
- [x] Expose one normal parent extension entrypoint while keeping the child companion package-internal and explicitly loadable only by managed child processes.
- [x] Detect inert, parent, and child roles before any role-specific registration or resource startup.
- [x] Outside tmux, show exactly one warning and register no tool, command, hook-driven UI, timer, poller, or child resource.
- [x] Agree on test seams before writing tests: the complete installed Pi extension is primary; pure policy, storage validation, event identity, lifecycle, mailbox, and layout interfaces are supplemental seams.
- [x] Provide repeatable commands for formatting, typecheck, unit tests, pane-layout prototype checks, and isolated real Pi-in-tmux E2E tests.
- [x] Make the E2E harness apply chezmoi source, isolate Pi and tmux state, drive a real TUI through a PTY, fail closed on missing evidence, preserve readable logs, and clean all temporary processes and files.
- [x] Demonstrate supported and unsupported startup through the real harness with no lint, typecheck, test, or process-leak failure.

**Shared context and history:** [Issue index](../index.md), including [comments](../index.md#comments).
