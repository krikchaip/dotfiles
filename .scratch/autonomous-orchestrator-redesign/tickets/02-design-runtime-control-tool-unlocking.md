# Design Runtime-Only Control-Tool Unlocking

Type: research
Status: resolved
Blocked by:

## Question

How should the extension initially expose only `Agent`, unlock `get_subagent_result` and `steer_subagent` after the first successful spawn, preserve unrelated active-tool settings, and reset the unlock on reload or session replacement without changing tool/parameter descriptions?

## Answer

Keep this state and its activation seam in `src/index.ts`. It owns all three top-level tool registrations and Pi's session lifecycle; `AgentManager` continues to own spawning, queueing, and agent state. Do not add a persistence entry, setting, prompt text, or tool-schema change.

After all three `pi.registerTool(...)` calls, call one private activation helper. It reads `pi.getActiveTools()`, removes only `get_subagent_result` and `steer_subagent`, retains every other active name, ensures `Agent` is present, then calls `pi.setActiveTools(...)`. This makes `Agent` the sole Pi-Subagents tool initially exposed while preserving built-ins and tools owned by other extensions. The helper must build from the current active list on every call, not restore a startup snapshot, so other runtime tool choices survive unlocking.

Keep a closure-local `controlToolsUnlocked = false`. A second private helper is idempotent: when false, it reads the current active tools, adds `get_subagent_result` and `steer_subagent` without duplicates, calls `setActiveTools`, then sets the flag true. Call it only after a new `Agent` spawn succeeds:

- Background execution: immediately after `manager.spawn(...)` returns its id, including an accepted queued record.
- Foreground execution: in existing `manager.spawnAndWait(..., onSpawned)` callback, after its record exists and before `onSessionCreated` can run.
- Do not unlock on validation/spawn exceptions, schedule registration (no spawn), or `resume` (no new spawn).

`setActiveTools` rebuilds Pi's tool prompt immediately, so no manual prompt mutation belongs here. Existing descriptions and parameter schemas stay byte-for-byte unchanged.

No explicit reset handler is needed. Pi reload, `/new`, `/resume`, `/fork`, and session replacement emit `session_shutdown`, tear down the extension runtime, then bind a new extension instance. That instance starts with a new `controlToolsUnlocked = false` and runs initial activation again. Do not persist unlock state and do not attempt to restore active tools on shutdown; restoring a stale snapshot could overwrite unrelated runtime choices.

Compatibility: Pi added `ExtensionAPI.setActiveTools()` in 0.39.0; this extension's peer floor is already `>=0.74.0`. No migration or peer-dependency change is needed.

Verification belongs in a new focused `test/control-tool-unlocking.test.ts`: mock `getActiveTools`/`setActiveTools`, prove initial removal preserves unrelated tools; prove one successful background and one successful foreground spawn unlock exactly once; prove rejected spawn, scheduling, and resume do not unlock; and prove a fresh extension instance begins locked. Keep existing lifecycle tests unchanged except where their Pi mock needs active-tool methods.
