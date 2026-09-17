---
name: pi-extension-sync
description: Review upstream changes and sync a forked Pi extension.
disable-model-invocation: true
---

# Pi Extension Sync

This workflow starts from a GitHub comparison URL. Resolve its local repository and branches from GitHub, Pi settings, and Git history.

## Uncertainty gate

Investigate available facts first. If uncertainty remains at any step, use `/skill:grill-with-docs` and wait for shared understanding before making a decision or changing a branch.

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

## 3. Determine the architecture mode

Compare the frozen personal baseline with the pre-sync primary branch and relevant history. Architecture means module responsibilities, boundaries, public seams, dependency directions, and composition rules. File differences alone do not prove an architecture difference.

Classify the sync:

- **Architecture aligned:** the user has not changed the extension architecture. Record the evidence, keep the normal sync workflow, and skip architecture documentation and translation work.
- **Architecture diverged:** the personal branch has changed the extension architecture. Preserve the Personal architecture while integrating upstream behavior.

For an architecture-diverged sync:

1. Read the repository's architecture documentation and inspect the personal code and refactor history.
2. Treat the personal code as authoritative. When documentation conflicts with the code, update the documentation on the dated candidate to describe the code.
3. When architecture documentation is absent, add a concise repository-owned architecture document on the dated candidate. Describe current responsibilities, boundaries, public seams, dependency directions, and composition rules.
4. Use the reconciled documentation as the architecture reference for translation. Do not add tests that enforce a fixed architecture or directory layout.
5. Apply the uncertainty gate only when the code and history do not identify one clear responsibility or boundary.

Completion: the sync is classified as architecture aligned or architecture diverged with evidence. For a diverged sync, the dated candidate contains architecture documentation that agrees with the frozen personal code.

## 4. Review upstream and plan integration

Treat the comparison URL as the review boundary. The local primary branch does not contain these upstream changes yet.

1. Resolve the complete upstream commit range from the pre-sync primary tip through the reviewed upstream ref.
2. Use changed `CHANGELOG.md` bullets as the first review index. If no changelog exists, use changed `README.md` items. Start with the oldest documented change in the comparison and continue to the newest.
3. Reconcile that index against every upstream commit and every changed production file in the range. Group related changes into an **Upstream behavioral delta**. Record verified non-behavioral changes separately. No commit or changed production file can remain unaccounted for.
4. For each delta, inspect the related source, tests, documentation, and history needed to identify behavior added, changed, or removed. Upstream file placement is evidence, not the required destination in the personal branch.
5. Assess feature compatibility before code compatibility:
   - Find intentional feature removals, disabled commands, improvements, replacements, and behavior changes in the personal branch.
   - Treat these personal decisions as the policy for the candidate.
   - When upstream changes a feature that the personal branch intentionally removed or replaced, preserve the personal behavior across code, documentation, tests, configuration, and registrations.
   - Combine upstream and personal behavior only when both intents remain compatible.
6. For an architecture-aligned sync, use the normal integration action: accept upstream behavior, combine compatible behavior, preserve personal behavior, or keep a feature removed.
7. For an architecture-diverged sync, create an **Architecture translation** plan for every applicable delta:
   - Name the upstream commits, files, symbols, and observed behavior.
   - Name the responsible personal module, public seam, and composition point from the architecture documentation.
   - State which upstream placement or dependency must not survive.
   - Name the behavior tests or project checks that will verify the result.
   - Create a cohesive new personal module when the delta has no existing owner. Connect it through the documented composition model.
8. Continue without asking when one translation destination is clear. Apply the uncertainty gate when ownership is ambiguous, personal and upstream behavior conflict without an existing decision, or the delta cannot fit the documented Personal architecture.
9. Present the review in the chat unless the user asks you to save it. For each delta or non-behavioral change, report:
   - `Upstream evidence:` commits, documentation items, files, and symbols.
   - `Applies:` yes, no, or partly.
   - `Feature compatibility:` compatible, personal override, not applicable, or decision required.
   - `Architecture mode:` aligned or diverged.
   - `Destination:` normal integration action, or the named Architecture translation destination.
   - `Evidence plan:` behavior tests and project checks.

Use ASD-STE100 Simplified Technical English.

Completion: every upstream commit and changed production file is accounted for; every delta has a feature decision; and every applicable delta has either a normal integration action or a concrete Architecture translation plan.

## 5. Gate the sync

Give one clear result: `safe to sync`, `decision required`, or `do not sync`.

`safe to sync` describes the pre-rebase compatibility decision only. It does not mean `regression-clean`. Reserve `regression-clean` and “no regression found” for successful completion of Section 7.

A verified personal feature decision overrides conflicting upstream behavior. For an architecture-diverged sync, the documented Personal architecture overrides conflicting upstream placement and dependencies. `safe to sync` requires a destination for every applicable Upstream behavioral delta.

When the result is `safe to sync`, offer to perform the sync. Ask for explicit approval to update the remote fork primary branch, fast-forward the local primary branch, rebase the dated candidate, and apply the presented translation plan when architecture diverged. State that `personal` will remain at the immutable baseline SHA. One approval authorizes every listed translation; apply the uncertainty gate again only for a required deviation.

After approval:

1. Run `gh repo sync <fork-owner>/<repository> --branch <primary-branch>` to sync the remote fork from its GitHub parent.
2. Fetch the updated fork remote into the local repository.
3. Fast-forward the local primary branch to its remote-tracking branch.
4. Verify that both primary branches contain the reviewed upstream commits.

Use fast-forward updates only. If GitHub reports divergence, a conflict, or a different parent, apply the uncertainty gate instead of using `--force`.

Completion: required decisions are settled, the remote and local primary branches contain the reviewed upstream commits, and the user has approved the rebase and any planned Architecture translation.

## 6. Rebase and translate the dated candidate

After approval, verify that the primary branch contains the reviewed upstream commits. Record the pre-rebase candidate SHA. Then use `/skill:resolving-merge-conflicts` to rebase only `personal-YYYYMMDD` onto the primary branch.

A **code conflict** is a Git merge collision. A **feature conflict** is incompatible behavior. An **architecture conflict** is upstream code that violates the documented Personal architecture. Feature and architecture conflicts can exist when Git completes the rebase without a code conflict.

After the rebase:

1. Verify that the candidate is based on the updated primary branch.
2. Verify that `personal` still equals the immutable baseline SHA.
3. Record every conflict-touched file and changed patch.
4. For an architecture-aligned sync, continue without translation work.
5. For an architecture-diverged sync, apply every approved Architecture translation as one or more separate candidate commits after the rebase:
   - Preserve the Upstream behavioral delta through the named personal modules and seams.
   - Remove or bypass duplicate implementation that landed in an obsolete upstream location.
   - Keep the documented responsibilities, dependency directions, and composition rules.
   - When translation adds a module or changes a documented detail, update the architecture documentation in the same translation commit to agree with the code.
   - In each translation commit, identify the upstream change, extracted behavior, personal destination, and verification evidence.
6. Apply the uncertainty gate before any translation that must deviate from the approved plan. Do not move `personal`.

Completion: the dated candidate is rebased; `personal` is unchanged; and every approved Architecture translation is present as a separate, auditable candidate change.

## 7. Review preservation and integration

1. Run `git range-diff` between the pre-rebase candidate stack and the rebased candidate stack. Identify every changed personal patch and every file touched during conflict resolution.
2. Compare the candidate with the frozen baseline across every invariant in the personal commit corpus. Include shared personal commits that do not appear in the branch-only range-diff.
3. Reconcile the final candidate against every Upstream behavioral delta and verified non-behavioral change. Inspect files that arrived without code conflicts as well as translation commits.
4. For an architecture-diverged sync, inspect the final code against the reconciled architecture documentation. Verify module responsibility, public seams, dependency direction, composition, and absence of duplicate legacy ownership. Review the code directly; do not add architecture-enforcement tests.
5. Inspect related source, documentation, behavior tests, configuration, registrations, upstream-changed files, conflict-touched files, and changed patches.
6. Present a preservation report. Give each personal invariant one status:
   - `preserved`
   - `intentionally changed by an approved upstream decision`
   - `missing`
   - `uncertain`

   Give each applicable upstream delta one status:
   - `integrated`
   - `missing`
   - `uncertain`

   For architecture-diverged syncs, give each documented responsibility or boundary one status:
   - `preserved`
   - `violation`
   - `uncertain`

7. For every `missing`, `violation`, or `uncertain` item, show the exact difference, relevant files or symbols, proposed correction, and behavior evidence that will verify it.
8. Report `decision required` and wait for approval before applying newly discovered corrections. Apply approved corrections only on the dated candidate, then rerun the complete review.
9. Do not weaken a behavior assertion unless an approved upstream decision changed that behavior.
10. When no item is missing, violated, or uncertain, run:
    - Every unchanged baseline E2E case against the candidate.
    - All project checks.
    - The complete real-TUI E2E suite.
11. Present the personal and upstream evidence with candidate results. Clean generated runtime artifacts and remove the detached baseline worktree.

Until every behavior evidence row passes and, for an architecture-diverged sync, every documented architecture item is preserved, report `regression status: unverified`.

Completion: every personal invariant is preserved or intentionally changed by an approved decision; every Upstream behavioral delta is integrated or intentionally excluded; architecture-diverged code agrees with its documentation; and all applicable checks pass.

## 8. Hand the dated candidate to the user

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
