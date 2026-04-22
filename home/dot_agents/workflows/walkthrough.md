---
description: An end-to-end guided walkthrough of any codebase feature, architectural aspect, or logic flow, combining deep code analysis with high-level behavioral and system design explanation
---

# Walkthrough

Explain any feature, architectural aspect, or logic flow in the codebase. This is a comprehensive guide that bridges the gap between raw code and high-level behavior.

Start by defining the scope:

1. **Scope Definition**: Ask the user what they want to walk through (e.g., "The auth flow", "How data is saved", "Project architecture").
2. **Context Gathering**: Search the codebase for entry points, configuration files, and core logic related to the request.
3. **Initial Overview**: Provide a high-level summary of the feature/aspect and list the primary files/modules involved.

Then, proceed with a guided, interactive exploration:

---

## Phase 1: The Blueprint (Structure)

Show the "bones" of the feature:

- **Core Components**: Key classes, functions, and files.
- **Dependencies**: What external libraries or internal modules does this rely on?
- **Data Model**: What are the primary data structures or database entities involved?

---

## Phase 2: The Flow (Execution)

Trace the life cycle of a request or the execution of a logic block:

- **Entry Points**: Where does the process start? (e.g., API endpoint, CLI command, UI event).
- **Interactive Exploration**:
  - **PRIORITIZE LSP**: Always use LSP operations first for maximum precision.
  - **Fallback**: If LSP is unavailable or fails, fall back to other search methods for callsite discovery and manual file analysis.
- **Trace Guides**: For every jump, explain _why_ it's happening and what the _business logic_ is at that point.

---

## Phase 3: The "Why" (Design & Architecture)

Analyze decisions and constraints at both code and system levels:

- **Code Patterns**: Identify design patterns (e.g., Middleware, Repository, Factory).
- **System Design**: Explain how this fits into the broader architecture (e.g., Microservices, Event-driven, Layered). Cover infrastructure (DBs, caches), protocols (REST, gRPC), and reliability (retry logic, concurrency).
- **Trade-offs**: Explain why it was likely built this way (e.g., performance vs. maintainability).
- **Side Effects**: What else happens in the system during this process? (e.g., logs, events, cache updates, background jobs).

---

## Interactive Controls

At any point, the user can:

- `[D] Dive deeper`: Explore a specific function or module.
- `[Z] Zoom out`: Return to the high-level overview.
- `[Q] Ask question`: Ask a clarifying question about the current context.
- `[E] Exit`: End the walkthrough and generate the final map.

---

## Summary (The Codemap)

When finished, generate a "Feature Codemap":

1. **Visual Diagram**: A Mermaid diagram (Flowchart, Sequence, or Component diagram) of the process.
2. **Key Landmarks**: A curated list of the most important files/lines.
3. **Behavioral Narrative**: A plain-English walkthrough of the feature from start to finish.
4. **Maintenance Tips**: Where to look first if this feature breaks or needs changes.

---

## Constraints

- Balance code details with high-level explanation.
- Always tie code snippets back to user-facing behavior.
- Use LSP for technical precision, but use repo-wide search for "big picture" context.

---

## User Input (optional)

> ...$ARGUMENTS
