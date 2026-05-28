# DOMAIN.md Format

## Structure

```md
# {Domain Name}

{One or two sentence description of what this domain is and why it exists.}

## Language

**Order**:
{A one or two sentence description of the term}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request

**Customer**:
A person or organization that places orders.
_Avoid_: Client, buyer, account
```

## Rules

- **Be opinionated.** When multiple words exist for the same concept, pick the best one and list the others as aliases to avoid.
- **Flag conflicts explicitly.** If a term is used ambiguously, call it out in "Flagged ambiguities" with a clear resolution.
- **Keep definitions tight.** One or two sentences max. Define what it IS, not what it does.
- **Show relationships.** Use bold term names and express cardinality where obvious.
- **Only include terms specific to this project's domain.** General programming concepts (timeouts, error types, utility patterns) don't belong even if the project uses them extensively. Before adding a term, ask: is this a concept unique to this domain, or a general programming concept? Only the former belongs.
- **Group terms under subheadings** when natural clusters emerge. If all terms belong to a single cohesive area, a flat list is fine.
- **Write an example dialogue.** A conversation between a dev and a domain expert that demonstrates how the terms interact naturally and clarifies boundaries between related concepts.

## Single vs multi-domain repos

**Single domain (most repos):** One `DOMAIN.md` at the repo root `.agents/artifacts/`.

**Multiple domains:** A `DOMAIN-MAP.md` at the repo root `.agents/artifacts/` lists the domains, where they live, and how they relate to each other:

```md
# Domain Map

## Domains

- [Ordering](./src/ordering/.agents/artifacts/DOMAIN.md) — receives and tracks customer orders
- [Billing](./src/billing/.agents/artifacts/DOMAIN.md) — generates invoices and processes payments
- [Fulfillment](./src/fulfillment/.agents/artifacts/DOMAIN.md) — manages warehouse picking and shipping

## Relationships

- **Ordering → Fulfillment**: Ordering emits `OrderPlaced` events; Fulfillment consumes them to start picking
- **Fulfillment → Billing**: Fulfillment emits `ShipmentDispatched` events; Billing consumes them to generate invoices
- **Ordering ↔ Billing**: Shared types for `CustomerId` and `Money`
```

The skill infers which structure applies:

- If `.agents/artifacts/DOMAIN-MAP.md` exists, read it to find domains
- If only a root `.agents/artifacts/DOMAIN.md` exists, single domain
- If neither exists, create a root `.agents/artifacts/DOMAIN.md` lazily when the first term is resolved

When multiple domains exist, infer which one the current topic relates to. If unclear, ask.
