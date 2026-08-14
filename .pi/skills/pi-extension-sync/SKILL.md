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

## 2. Capture the personal regression scope

Before changing branches, inspect every commit that the personal branch has on top of the primary branch. Map each commit to the behavior it adds, changes, or removes.

Build a regression checklist that covers:

- Added personal features.
- Changed upstream behavior.
- Removed or disabled features, with a check that they stay absent.
- Personal configuration and integration behavior.

One test scenario can cover several commits, but every personal commit must map to a scenario or a verified non-behavioral change.

Completion: the regression checklist accounts for every personal commit on top of the primary branch.

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

A verified personal feature decision overrides conflicting upstream behavior. Apply the uncertainty gate when personal intent is unclear or no existing personal decision settles an incompatible feature choice.

When the result is `safe to sync`, offer to perform the sync. Ask for explicit approval to update the remote fork primary branch, fast-forward the local primary branch, and start the rebase.

After approval:

1. Run `gh repo sync <fork-owner>/<repository> --branch <primary-branch>` to sync the remote fork from its GitHub parent.
2. Fetch the updated fork remote into the local repository.
3. Fast-forward the local primary branch to its remote-tracking branch.
4. Verify that both primary branches contain the reviewed upstream commits.

Use fast-forward updates only. If GitHub reports divergence, a conflict, or a different parent, apply the uncertainty gate instead of using `--force`.

Completion: required product decisions are settled, the remote and local primary branches contain the reviewed upstream commits, and the user has approved the rebase.

## 5. Rebase the personal branch

After approval, verify that the primary branch contains the reviewed upstream commits. Then use `/skill:resolving-merge-conflicts` to rebase the personal branch onto the primary branch.

A **code conflict** is a Git merge collision. A **feature conflict** is incompatible behavior. A feature conflict can exist even when Git completes the rebase without a code conflict. Apply every feature decision from the comparison review whether or not Git reports a conflict.

After the rebase:

1. Check the final code against each decision from the review.
2. If a decision says personal behavior wins, make sure the final code keeps that behavior.
3. Fix any mismatch, even if Git reported no conflicts.

Example: if the review says `/idea` must stay removed, confirm that `/idea` is absent from the final code.

Completion: `/skill:resolving-merge-conflicts` finishes the rebase, and the final source satisfies every reviewed feature action, including actions with no code conflict.

## 6. Regression-test personal customizations

Before the final report:

1. Run every scenario in the personal regression checklist.
2. Use `/skill:pi-extension-e2e` for user-visible Pi extension behavior. Test added and changed behavior in the real TUI. Test removed behavior by proving it stays absent.
3. Fix each regression, then rerun its scenario and all applicable project checks.
4. Record pass evidence for every checklist item.

Send the final report only after every personal customization passes or the uncertainty gate resolves a blocker.

Completion: every personal commit is accounted for, every customized behavior has regression evidence, and all applicable project checks pass.
