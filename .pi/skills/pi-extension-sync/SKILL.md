---
name: pi-extension-sync
description: Review upstream changes and sync a forked Pi extension.
disable-model-invocation: true
---

# Pi Extension Sync

This workflow starts from a GitHub comparison URL. Resolve its local repository and branches from GitHub, Pi settings, and Git history.

## Uncertainty gate

Investigate available facts first. If uncertainty remains at any step, use `/skill:grilling` and wait for shared understanding before making a decision or changing a branch.

## 1. Resolve the local context

1. Decode the comparison URL. Identify both repository owners, both refs, and the repository name.
2. Get the user's GitHub login through the GitHub MCP server or `gh api user --jq .login`. Use it to identify the user's fork side and the upstream side of the comparison. Confirm the direction from the comparison page and repository relationship.
3. Read the active Pi settings. Find the matching `packages` entry whose source starts with `git:`. A source such as `git:github.com/<owner>/<repository>@<branch>` maps to `~/.pi/agent/git/github.com/<owner>/<repository>` and selects `<branch>`.
4. Infer:
   - **Extension repository:** the local Git path mapped from the matching `git:` package source. Confirm it with Git remotes.
   - **Personal branch:** the branch after `@` in that source. If no branch is specified, inspect the checked-out branch and local history.
   - **Primary branch:** the branch on the user's fork side of the comparison. Confirm it against the remote default branch and local history.
   - **Upstream ref:** the repository and branch on the other side of the comparison.
5. If no package entry matches, search `~/.pi/agent/git/github.com/` by the owners and repository name from the URL, then confirm candidates by Git remotes. Apply the uncertainty gate when no unique candidate exists.

Completion: one local repository, one upstream ref, one primary branch, and one personal branch are identified with evidence. Keep all branches unchanged during this step.

## 2. Freeze the baseline, create the candidate, and prove the personal scope

1. Require a clean repository. Record:
   - The exact `personal` tip as the immutable baseline SHA.
   - The exact primary-branch tip before synchronization.
   - The current local calendar date as `YYYYMMDD`.
2. Create and switch to `personal-YYYYMMDD` at the exact `personal` tip before making test, source, documentation, or configuration changes.
3. Keep `personal` unchanged for the complete workflow. Make every test commit, approved fix, and rebase only on the dated candidate.
4. If `personal-YYYYMMDD` already exists, stop and ask whether to resume it. Report its tip and worktree state. Never reset, delete, or overwrite it.
5. Keep a detached worktree at the immutable baseline SHA until the final regression gate.
6. Resolve the user's verified Git author identity or identities from the GitHub login, local Git configuration, and repository history. Apply the uncertainty gate when an identity is ambiguous.
7. Define the **personal commit corpus** as every commit reachable from the baseline SHA whose author matches a verified user identity. Include commits that are already reachable from the primary or upstream branch.
8. Classify each corpus commit as:
   - Branch-only.
   - Shared with the pre-sync primary branch.
9. Show all three counts and prove:

   ```
   personal corpus = branch-only personal commits + shared personal commits
   ```

   Keep branch divergence as a separate metric. Never label `primary..personal` alone as the personal commit count.

10. Map every personal corpus commit to the behavior it adds, changes, or removes.
11. Build a visible regression evidence table with these columns:
    - Personal commit.
    - Branch-only or shared.
    - User-visible invariant or verified non-behavioral change.
    - Named E2E case or project check.
    - Command.
    - Baseline result.
12. For each user-visible invariant, record the trigger, first visible state, state transition, final result, and required absence. For startup, lifecycle, cache, or background work, include a bounded timing assertion and test the state while optional asynchronous work is blocked.
13. Find the canonical repository-owned real-TUI E2E command. Add missing cases on the dated candidate. Run those cases against the detached baseline and preserve the tests in the candidate stack.
14. If coverage reveals a baseline production defect, show the known-red evidence and get separate approval before changing production source.

One E2E case can cover several commits, but every personal corpus commit must have its own table row.

Completion: `personal` is frozen, the dated candidate exists at its original tip, every verified user-authored commit reachable from the baseline has an evidence row, all counts reconcile, and every baseline case passes before primary synchronization or rebase.

## 3. Review the unsynced upstream changes

Treat the comparison URL as the boundary of the review. The local primary branch does not contain these upstream changes yet.

1. Use the documentation changes in the comparison as the review index. Do not catalog the complete source diff.
2. If `CHANGELOG.md` exists, review every relevant changelog bullet shown in its comparison diff. Start with the oldest change included in this diff and continue to the most recent change included in it. The oldest entry in the complete changelog is outside the review unless it also appears in the comparison diff.
3. If `CHANGELOG.md` does not exist, review every relevant bullet or documented change shown in the `README.md` comparison diff in the same order.
4. For each documentation item, inspect only the related source and history needed to assess its effect on the personal branch. The documentation item defines the scope; targeted code evidence verifies the assessment.
5. Assess feature compatibility before code compatibility:
   - Find intentional feature removals, disabled commands, improvements, replacements, and behavior changes in the personal branch.
   - Treat these personal decisions as the policy for the rebased branch.
   - When upstream changes a feature that the personal branch intentionally removed or replaced, preserve the personal behavior. Include related code, documentation, tests, configuration, and registrations. A clean code merge must not restore that feature.
   - Combine upstream and personal behavior only when both feature intents remain compatible.
6. Present the review in the chat unless the user asks you to save it to a file. After each changelog bullet or README item, give this assessment:
   - `Applies:` yes, no, or partly.
   - `Feature compatibility:` compatible, personal override, or decision required.
   - `Impact:` the concrete effect on the personal branch.
   - `Action:` accept upstream behavior, combine both, preserve personal behavior, or keep a feature removed.
   - `Evidence:` the relevant files or commits.

Use ASD-STE100 Simplified Technical English. Account for every relevant item in the comparison range.

Completion: every relevant changelog bullet, or every relevant README change when no changelog exists, has a verified feature assessment and merge action.

## 4. Gate the sync

Give one clear result: `safe to sync`, `decision required`, or `do not sync`.

`safe to sync` describes the pre-rebase compatibility decision only. It does not mean `regression-clean`. Reserve `regression-clean` and “no regression found” for successful completion of Section 6.

A verified personal feature decision overrides conflicting upstream behavior. Apply the uncertainty gate when personal intent is unclear or no existing personal decision settles an incompatible feature choice.

When the result is `safe to sync`, offer to perform the sync. Ask for explicit approval to update the remote fork primary branch, fast-forward the local primary branch, and rebase the dated candidate. State that `personal` will remain at the immutable baseline SHA.

After approval:

1. Run `gh repo sync <fork-owner>/<repository> --branch <primary-branch>` to sync the remote fork from its GitHub parent.
2. Fetch the updated fork remote into the local repository.
3. Fast-forward the local primary branch to its remote-tracking branch.
4. Verify that both primary branches contain the reviewed upstream commits.

Use fast-forward updates only. If GitHub reports divergence, a conflict, or a different parent, apply the uncertainty gate instead of using `--force`.

Completion: required product decisions are settled, the remote and local primary branches contain the reviewed upstream commits, and the user has approved the rebase.

## 5. Rebase the dated candidate

After approval, verify that the primary branch contains the reviewed upstream commits. Record the pre-rebase candidate SHA. Then use `/skill:resolving-merge-conflicts` to rebase only `personal-YYYYMMDD` onto the primary branch.

A **code conflict** is a Git merge collision. A **feature conflict** is incompatible behavior. A feature conflict can exist even when Git completes the rebase without a code conflict.

Apply feature decisions that the user approved during the comparison review. Do not move `personal`.

After the rebase:

1. Verify that the candidate is based on the updated primary branch.
2. Verify that `personal` still equals the immutable baseline SHA.
3. Record every conflict-touched file and changed patch.
4. Continue to the preservation review before making corrective changes for newly discovered omissions.

Completion: the dated candidate is rebased, `personal` is unchanged, and the candidate is ready for the preservation review.

## 6. Review preservation and gate corrective changes

1. Run `git range-diff` between the pre-rebase candidate stack and the rebased candidate stack. Identify every changed patch and every file touched during conflict resolution.
2. Compare the rebased candidate with the frozen baseline across every invariant in the personal commit corpus. This review includes shared personal commits that do not appear in the branch-only range-diff.
3. Inspect the related source, documentation, tests, configuration, registrations, conflict-touched files, and changed patches.
4. Present a preservation report. Give each invariant one status:
   - `preserved`
   - `intentionally changed by an approved upstream decision`
   - `missing`
   - `uncertain`
5. For every `missing` or `uncertain` item, show:
   - The personal commit and invariant.
   - The exact observed difference.
   - The relevant files or symbols.
   - The proposed correction.
   - The tests that will prove the correction.
6. Report `decision required` and wait for the user to review the gaps and approve specific corrections.
7. Apply only approved corrections, only on the dated candidate. Then rerun the complete preservation report.
8. Do not weaken an assertion unless an approved upstream decision changed that behavior.
9. When no item is missing or uncertain, run:
   - Every unchanged baseline E2E case against the candidate.
   - All project checks.
   - The complete real-TUI E2E suite.
10. Present the complete evidence table with candidate results. Clean generated runtime artifacts and remove the detached baseline worktree.

Until every evidence row passes, report `regression status: unverified`.

Completion: every personal corpus invariant is preserved or intentionally changed by an approved decision, every evidence row passes, and all applicable checks pass.

## 7. Hand the dated candidate to the user

1. Leave the clean repository checked out on `personal-YYYYMMDD`.
2. Report:
   - The candidate branch and SHA.
   - The unchanged `personal` SHA.
   - The automated gate results.
   - Any approved intentional behavior changes.
3. Ask the user to test the dated candidate.
4. Stop the sync workflow at this handoff. Do not push, delete the candidate, or move `personal`.
5. After the user reports successful testing, treat fast-forwarding `personal` as a separate risky action. Verify that it is a fast-forward and ask for explicit approval before doing it.

Completion: the user can test the exact verified dated candidate while `personal` remains unchanged.
