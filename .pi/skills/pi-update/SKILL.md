---
name: pi-update
description: Update Pi and prove custom plugin compatibility end to end.
disable-model-invocation: true
---

# Pi Update

Input: one `https://pi.dev/news/releases/<version>` URL. Establish the behavioral baseline, update Pi, then audit and repair the custom setup.

## Policy

- **Approval:** ask before the mise update, each repair set, and rollback. When custom intent stays unclear, read and follow the available `/skill:grilling` skill.
- **Behavioral parity:** after the target passes startup, compare every custom plugin and resource behavior with its proven baseline. Repair regressions after approval. Present every new or changed behavior for the user to preserve, adopt, or defer. Read each file again before editing; never overwrite newer user work.
- **Source class:** record each file as a chezmoi source with a verified target, or a repository-local source used directly. The class—not its path—decides whether to run targeted `chezmoi apply`.
- **Boundary:** treat all source under `home/dot_pi/agent/extensions/` and `home/dot_pi/agent/packages/` as customizations. Also audit custom settings, keybindings, themes, prompts, skills, agents, models, MCP, and Pi TypeScript setup. Exclude third-party packages outside those roots, caches, dependencies, generated files, and build output. Pi core is read-only evidence.
- **No-write checks:** before repair approval, run proven read-only checks in place. Run checks that can write in a temporary copy. Compare Git status before and after; stop on an unexpected source change and leave it untouched.

A **repair card** states the release item or failure, changed behavior, each planned code or configuration modification with its file and reason, behavior to preserve, and proof of the fix. A **behavior decision** states a new or changed behavior, baseline and target evidence, compatibility impact, options to preserve, adopt, or defer it, and a recommended next step. Present every release assessment, unexpected regression, repair card, and behavior decision in chat; write a file only when asked.

A **full-stack startup** follows the available `/skill:pi-extension-e2e` skill with a real PTY, `PI_OFFLINE=1`, and no saved session. From a neutral directory, load the real global Pi directory and all discovered resources without resource-disabling flags. Require a stable editor or footer marker and a clean exit. Repeat from each inventoried project that has Pi resources; handle trust without saving a new decision. Keep logs.

A **behavior matrix** accounts for every independent user-visible activation surface owned by each custom plugin or resource entrypoint. Each row records its owner, exact user action or terminal bytes, required fixture and state, positive oracle, negative oracle, baseline result, target result, behavior delta, and evidence. A **behavior delta** is any changed output, input handling, state transition, side effect, or newly reachable behavior, even when both results pass their oracles. Follow `/skill:pi-extension-e2e` for TUI rows. A loaded extension or clean startup does not prove an interaction row. Prefer the exact user path. When an external boundary cannot be automated safely, use the narrowest host-boundary fixture and name the boundary it excludes. Clipboard-owned rows also require one real OS-clipboard check on the baseline and target; ask the user to perform it when clipboard state cannot be replaced and restored losslessly. Example: the `image-attachments` Ctrl+V row sends `\x16`, supplies a valid Pi clipboard image, requires `[#image 1]`, and forbids a raw `pi-clipboard-<UUID>.<ext>` path.

## 1. Establish the baseline

1. Validate the Pi release page and GitHub tag. Read the current version from `pi --version`; require a newer target.
2. Build the stable release range from the first version newer than current through the target, inclusive. Exclude the current release. Confirm every page and tag, but defer content review.
3. Confirm that `pi` resolves through mise. Record the exact current version, tool key, and global config file.
4. Inventory both source classes within the policy boundary. Record Git status, Pi dependency pins and locks, and available lint, type-check, format-check, and test commands. Search test directories directly and reconcile every discovered executable test with package scripts; an omitted test remains required. Build the behavior matrix from extension entrypoints, package manifests, registered commands, keybindings, editor and clipboard hooks, renderers, settings, and existing tests. Account for every activation surface; internal helper modules belong to their owning entrypoint.
5. Run the available source checks, full-stack startup, and every behavior-matrix row on the current version. A row passes only from its own oracle evidence. Record each pre-existing failure and untested external boundary separately.

Completion: the range, global mise config, rollback version, source classes, checks, startup, and baseline result for every behavior-matrix row are proven.

## 2. Update through mise

1. Preview the exact target update with `mise use --global --pin npm:@earendil-works/pi-coding-agent@<target> --dry-run`. Confirm that the preview selects the target version.
2. Show current and target versions, the command and preview, baseline result, and relevant dirty files. Ask for approval.
3. After approval, run the same command without `--dry-run`. From a neutral directory, verify that `command -v pi`, `pi --version`, and the global mise config all select the exact target.

Completion: the user's normal Pi environment activates only the target version.

## 3. Restore startup

Run full-stack startup on the target.

For a custom compatibility failure, reproduce it through the user path, find the smallest cause, present a repair card from the startup evidence, and wait for approval. Apply approved work with section 5's reread, edit, chezmoi, and focused-proof rules; repeat until Pi starts. During the release audit, link each startup repair to its release item or classify it as unexpected.

If an excluded third-party package blocks startup, identify it without auditing or editing its source; report it and ask whether custom configuration should change so Pi can start. For a proven Pi defect with no valid custom repair, ask whether to diagnose further or roll back. An approved rollback must use a dry-run exact mise command against the same global config, restore the recorded version, and pass full-stack startup. Continue the release audit after rollback.

Completion: either the target starts, or an approved rollback restores a working previous version with upstream-blocker evidence.

## 4. Audit the release range

Review releases oldest to newest. Preserve each page's section and bullet order. Screen every bullet against the customization inventory from section 1.

For each bullet:

1. Read the release text and search for affected custom APIs, events, imports, schemas, settings, keybindings, rendering, startup behavior, or assumptions. Follow its PR, issue, tagged source, or history when needed to classify it.
2. Give a detailed review when it is a new feature or relates to anything in that customization inventory. This includes related breaking, fixed, documentation, provider, dependency, and performance changes.
3. For a detailed item, report `Applies`, concrete `Impact`, `Action`, and linked `Evidence`; use a focused no-write check when static evidence is insufficient.
4. For any unrelated item, give only one short line naming it and `Skipped: no custom match`. An unrelated breaking change is also safe to mention briefly. Point repeated summary bullets to the detailed item.

Then run applicable no-write static checks across custom source roots and the complete behavior matrix on the target, including rows with no predicted release match. Put write-capable checks in temporary copies. Compare each target result with its baseline, not only with its oracles. A lost baseline behavior is an `Unexpected regression`; additional or changed behavior requires a behavior decision. Keep baseline failures separate.

Completion: every included bullet is either reviewed in detail or mentioned briefly, the baseline release stays excluded, every behavior-matrix row has a target result and delta classification, and all repair candidates and behavior decisions are known. After rollback, mark target-runtime rows blocked by the proven defect and use release, PR, tagged-source, and startup evidence.

## 5. Repair and verify

1. Present one numbered set of repair cards and behavior decisions after the audit; startup blockers are the only earlier cards. Include target-version updates for applicable Pi development dependencies and lockfiles. Keep broad peer ranges unless evidence requires a narrower one. Wait for approval of specific repair numbers and a user disposition for every behavior decision.
2. For each approved card, reread affected files, make only approved edits, and regenerate approved locks with their package manager. Apply chezmoi sources only to verified targets; edit repository-local sources directly.
3. Verify source-to-target matches, then run each card's focused proof. New evidence that changes the repair requires a revised card and approval.
4. Run full-stack global and project startup, applicable source-root checks, each repair's focused regression, and the complete behavior matrix again. Require each row's positive and negative oracles and compare it with the baseline or user-approved behavior; retest unaffected rows because compatibility impact can escape the release audit and static search.
5. Report final version, reviewed range, startup, behavior-matrix results, approved repairs and evidence, deferred work, baseline failures, untested external boundaries, blockers, and rollback evidence.

Completion is one of:

- **Updated:** the exact target starts with the real custom stack; every release bullet and behavior-matrix row is accounted for; every regression is repaired; every new or changed behavior has a user disposition; every row and approved repair passes against the baseline or approved behavior.
- **Rolled back:** a proven upstream blocker led to approved rollback; the exact previous version starts; every release bullet and behavior-matrix row is accounted for; feasible rows and approved repairs pass; every behavior delta has a user disposition; blocked target rows are explicit.
