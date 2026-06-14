# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`.agents/artifacts/DOMAIN-MAP.md`** at the repo root — it points at one `DOMAIN.md` per domain. Read each one relevant to the topic.
- **`.agents/artifacts/adr/`** — read ADRs that touch the area you're about to work in. Also check `**/<domain>/.agents/artifacts/adr/` for domain-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The producer skill creates them lazily when terms or decisions actually get resolved.

## File structure

Multi-domain repo:

```
/
├── .agents/artifacts/DOMAIN-MAP.md
├── .agents/artifacts/adr/                  ← system-wide decisions
├── <some project>/
│   ├── ordering/
│   │   ├── .agents/artifacts/DOMAIN.md
│   │   └── .agents/artifacts/adr/          ← domain-specific decisions
│   └── billing/
│   │   ├── .agents/artifacts/DOMAIN.md
│   │   └── .agents/artifacts/adr/
├── <another project>/
│   ├── .agents/artifacts/DOMAIN.md
│   └── .agents/artifacts/adr/
└── ...(the rest)
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `DOMAIN.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding.
