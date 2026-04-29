---
name: artifacts-config
description: Master configuration for repository artifacts (Issues, PRDs, Domain Docs, ADRs)
---

# Artifacts Master Configuration

This skill is the source of truth for repository artifact structure and conventions. All engineering skills must use these paths and rules instead of factory defaults.

## 1. Issue Tracker (Local Markdown)

This repo uses local markdown files for issue tracking.

- **Root Location**: `.agents/artifacts/features/`
- **Feature Isolation**: One directory per feature: `.agents/artifacts/features/<feature-slug>/`
- **The PRD**: Found at `.agents/artifacts/features/<feature-slug>/PRD.md`.
- **Issues**: Stored at `.agents/artifacts/features/<feature-slug>/issues/<NN>-<slug>.md` (numbered from `01`).
- **Metadata**: Triage state is recorded as a `Status: <label>` line near the top of the file.
- **Interactions**: Append comments and history to the bottom under a `## Comments` heading.
- **Workflow**:
  - To "publish to the issue tracker": Create a new file in the path above.
  - To "fetch the relevant ticket": Read the file at the referenced path or ID.

## 2. Triage Label Vocabulary

The five canonical triage roles map 1:1 to these strings for this repo:

- `needs-triage`: Maintainer needs to evaluate.
- `needs-info`: Waiting on reporter/user.
- `ready-for-agent`: Fully specified; ready for AFK implementation.
- `ready-for-human`: Requires human implementation/judgment.
- `wontfix`: Will not be actioned.

## 3. Domain Documentation (Context & ADRs)

Engineering skills (`diagnose`, `tdd`, `improve-codebase-architecture`) must consume domain knowledge from here:

- **Primary Domain Context**: `.agents/artifacts/DOMAIN.md`
- **Architectural Decision Records (ADRs)**: `.agents/artifacts/adr/`

### Rules for Agents:

1. **Pre-flight Reading**: Before exploring code or proposing designs, read `.agents/artifacts/DOMAIN.md` and any relevant ADRs in `.agents/artifacts/adr/`.
2. **Vocabulary Enforcement**: Use terms exactly as defined in the glossary. Do not use synonyms.
3. **Contradiction Flagging**: If a proposal contradicts an ADR, explicitly state: _"Contradicts ADR-XXXX — but worth reopening because..."_
4. **Lazy Initialization**: Do not proactively create these files. The producer skill (`/grill-with-docs`) creates them only when terms or decisions are finalized.

## 4. Entry Point (Pointer Logic)

This configuration serves as the "Agent Skills" block for this environment. Skills should look here first for their operating parameters.
