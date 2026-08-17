---
name: pi-update
description: Update Pi and repair custom compatibility.
disable-model-invocation: true
---

# Pi Update

Input: one `https://pi.dev/news/releases/<version>` URL. Update Pi first, then audit and repair the custom setup.

## Policy

- **Approval:** ask before the mise update, each repair set, and rollback. When custom intent stays unclear, read and follow the available `/skill:grilling` skill.
- **Behavior:** preserve current custom behavior unless the user approves a change. Read each file again before editing; never overwrite newer user work.
- **Source class:** record each file as a chezmoi source with a verified target, or an in-place project source. The class—not its path—decides whether to run targeted `chezmoi apply`.
- **Boundary:** audit custom extensions, local packages, settings, keybindings, themes, prompts, skills, agents, models, MCP, and Pi TypeScript setup. Exclude third-party packages, caches, dependencies, generated files, and build output. Pi core is read-only evidence.
- **No-write checks:** before repair approval, run proven read-only checks in place. Run checks that can write in a temporary copy. Compare Git status before and after; stop on an unexpected source change and leave it untouched.

A **repair card** states the release item or failure, changed behavior, each planned code or configuration modification with its file and reason, behavior to preserve, and proof of the fix. Present every release assessment, unexpected regression, and repair card in chat; write a file only when asked.

A **full-stack startup** follows the available `/skill:pi-extension-e2e` skill with a real PTY, `PI_OFFLINE=1`, and no saved session. From a neutral directory, load the real global Pi directory and all discovered resources without resource-disabling flags. Require a stable editor or footer marker and a clean exit. Repeat from each inventoried project that has Pi resources; handle trust without saving a new decision. Keep logs.

## 1. Establish the baseline

1. Validate the Pi release page and GitHub tag. Read the current version from `pi --version`; require a newer target.
2. Build the stable release range from the first version newer than current through the target, inclusive. Exclude the current release. Confirm every page and tag, but defer content review.
3. Confirm that `pi` resolves through mise. Record the exact current version, tool key, config file, and global or local scope.
4. Inventory both chezmoi-managed and in-place project sources within the policy boundary. Record Git status, Pi dependency pins and locks, and available lint, type-check, format-check, and test commands.
5. Run the full-stack startup on the current version. Record pre-existing failures separately.

Completion: the range, mise scope, rollback version, source classes, checks, and working baseline are proven.

## 2. Update through mise

1. Preview the exact target update with `mise use --global --pin npm:@earendil-works/pi-coding-agent@<target> --dry-run`. Confirm that the preview selects the target version.
2. Show current and target versions, the command and preview, baseline result, and relevant dirty files. Ask for approval.
3. After approval, run the same command without `--dry-run`. From a neutral directory, verify that `command -v pi`, `pi --version`, and the global mise config all select the exact target.

Completion: the user's normal Pi environment activates only the target version.

## 3. Restore startup

Run full-stack startup on the target.

For a custom compatibility failure, reproduce it through the user path, find the smallest cause, present a repair card from the startup evidence, and wait for approval. Apply approved work with section 5's reread, edit, chezmoi, and focused-proof rules; repeat until Pi starts. During the release audit, link each startup repair to its release item or classify it as unexpected.

If an excluded third-party package blocks startup, identify it without auditing or editing its source; report it and ask whether custom configuration should change so Pi can start. For a proven Pi defect with no valid custom repair, ask whether to diagnose further or roll back. An approved rollback must use a dry-run exact mise command against the same config and scope, restore the recorded version, and pass full-stack startup. Continue the release audit after rollback.

Completion: either the target starts, or an approved rollback restores a working previous version with upstream-blocker evidence.

## 4. Audit the release range

Review releases oldest to newest. Within each page, preserve section and bullet order. Account for every summary, added, changed, fixed, documentation, provider, dependency, and performance bullet.

For each bullet:

1. Read its release text and linked PR or issue. Use tagged source and history when no link explains the implementation.
2. Search the custom inventory for affected APIs, events, imports, schemas, settings, keybindings, rendering, startup behavior, and assumptions.
3. Use a focused no-write check when static evidence is insufficient.
4. Report `Applies`, concrete `Impact`, `Action`, and linked `Evidence`. Give repeated summary bullets their own short entry that points to the detailed assessment.

Then run applicable no-write static and behavior checks across custom source roots. Put write-capable checks in temporary copies. Report new failures under `Unexpected regressions`; keep baseline failures separate.

Completion: every included bullet has one evidence-based assessment, the previous current release stays excluded, and all repair candidates are known. After rollback, mark target-runtime checks blocked by the proven defect and use release, PR, tagged-source, and startup evidence.

## 5. Repair and verify

1. Present one numbered set of repair cards after the audit; startup blockers are the only earlier cards. Include target-version updates for applicable Pi development dependencies and lockfiles. Keep broad peer ranges unless evidence requires a narrower one. Wait for approval of specific numbers.
2. For each approved card, reread affected files, make only approved edits, and regenerate approved locks with their package manager. Apply managed sources only to verified targets; use in-place project sources directly.
3. Verify source-to-target matches, then run each card's focused proof. New evidence that changes the repair requires a revised card and approval.
4. Run full-stack global and project startup, applicable source-root checks, focused regressions, and real-TUI E2E for every affected user-visible resource. Include negative checks for behavior that must stay absent or unchanged.
5. Report final version, reviewed range, startup, approved repairs and evidence, deferred work, baseline failures, blockers, and rollback evidence.

Completion is one of:

- **Updated:** the exact target starts with the real custom stack; every release bullet is accounted for; all approved repairs pass.
- **Rolled back:** a proven upstream blocker led to approved rollback; the exact previous version starts; every release bullet is accounted for; feasible approved repairs pass; blocked target checks are explicit.
