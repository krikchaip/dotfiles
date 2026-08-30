---
name: pi-update
description: Update Pi and verify all custom behavior.
disable-model-invocation: true
---

# Pi Update

Input: one `https://pi.dev/news/releases/<version>` URL.

## Pass conditions

- The target version starts with the full custom setup.
- Every custom plugin works as it did on the previous version.
- Every approved fix passes.
- The user decides what to do with each new behavior.

## Safety

- Ask before update, repair, or rollback writes.
- Preserve old behavior unless the user approves a change.
- Read each file again before editing it.
- Keep newer user work.
- Record whether a file is a chezmoi source or a file used directly.
- Apply chezmoi changes only to verified targets.
- Treat `home/dot_pi/agent/extensions/`, `home/dot_pi/agent/packages/`, and other custom Pi resources as custom work.
- Use Pi core and third-party code as read-only evidence.
- Run every interactive Pi process with a disposable `PI_CODING_AGENT_DIR`. Copy mutable config and link read-only custom resources.
- Run write-capable checks in a temporary copy.
- Pin and record the Pi executable used by every baseline and target test.
- Compare source status after each check. Stop on a new source change.

## 1. Record old behavior

1. Validate the target release page and GitHub tag. List stable releases after the current version through the target.
2. Run:
   ```text
   scripts/preflight.py <target> > /tmp/pi-update-preflight.json
   ```
3. Use the inventory to make one test list. Include every loaded extension file and package extension. For each plugin, include every command, shortcut, hook, renderer, and other visible behavior. Include discovered tests even when package scripts omit them.
4. Run:
   ```text
   scripts/startup.expect <current-version>
   ```
   Repeat with `scripts/startup.expect <current-version> <project-dir>` for each project with Pi resources. Use stable tmux pane captures for fullscreen readiness; repaint byte streams are not stable readiness evidence.
5. Follow `/skill:pi-extension-e2e`. Run every plugin test. Each test sends the real user input, checks the expected result, and checks that known bad output is absent. A group test must prove a separate result for each plugin.
6. Save the command, Pi version, Pi path, and result for every plugin. Keep old failures separate.

Before accepting an E2E result, assert the child TUI version. Package runners can prepend local `node_modules/.bin` and start another Pi version. Call the harness file directly with the selected Mise bin first in `PATH` when this occurs.

Do not update until every plugin has a saved baseline result. For a baseline failure, show the exact evidence and ask the user to repair or carry it.

## 2. Update Pi

1. Preview:
   ```text
   scripts/mise-update.nu <target>
   ```
2. Show the preview, old test results, and relevant dirty files. Ask for approval.
3. After approval, apply:
   ```text
   scripts/mise-update.nu <target> --apply
   scripts/verify-version.py <target>
   ```

The running agent keeps its startup `PATH`. Use `mise exec --` or the exact target executable for all remaining checks.

Do not continue unless a fresh Mise environment uses the exact target.

## 3. Test target startup

Run:

```text
scripts/startup.expect <target>
```

Repeat with `scripts/startup.expect <target> <project-dir>` for each project with Pi resources.

If startup fails:

1. Reproduce the failure through the user path.
2. Find the smallest cause.
3. Show a numbered fix proposal with files, reason, behavior to keep, and proof.
4. Wait for approval, apply the fix, and repeat startup.

Do not edit third-party code. If Pi itself is broken and no safe custom fix exists, ask whether to investigate or roll back. Preview and approve rollback before writing.

Do not continue until startup passes or the approved rollback passes.

## 4. Test every plugin on the target

1. Repeat every previous-version plugin test with the exact target executable. Test all plugins. Release notes and changed-file lists do not reduce this set.
2. Compare each result:
   - Same: pass.
   - Old behavior is broken or missing: propose a fix.
   - Behavior is new or different: show the evidence and ask the user to preserve, accept, or defer it.
   - Failure also existed before: carry it only when the scenario and failure signature match.
3. For clipboard behavior, use the real OS clipboard on both versions. Ask the user to perform the test when the clipboard cannot be restored safely.
4. Run all source checks. Use a temporary copy for checks that write.
5. Review every release in the range. For related items, report `Applies`, `Impact`, `Action`, and evidence. For unrelated items, report `Skipped: no custom match`.

Do not continue until every plugin has a target result and every difference is reported.

## 5. Repair and finish

1. Show one numbered list of fixes and user decisions. Wait for approval.
2. Reread and edit only approved files. Update approved locks. Apply verified chezmoi targets.
3. Verify source and runtime files match. Run each focused test.
4. Repeat version verification, startup, source checks, and every plugin test.
5. Report the version, release range, startup results, every plugin result, fixes, user decisions, old failures, deferred work, blockers, and rollback evidence.

Finish only when the exact target starts, every passing baseline still passes, every carried baseline failure matches, every regression is fixed, and the user has decided what to do with every new behavior.
