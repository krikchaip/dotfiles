/**
 * Shows compaction summaries only at the bottom.
 *
 * Pi persists each compaction entry, then renders it at the active-context
 * boundary. When a compaction completes, Pi also appends the same summary above
 * the editor. This extension omits persisted summaries only from chat renders,
 * leaving the immediate, bottom summary as the single visible card.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
type SessionManager = ExtensionContext["sessionManager"];
type PatchableSessionManager = SessionManager & {
  buildContextEntries(): SessionEntry[];
};

type PatchState = {
  originalBuildContextEntries: () => SessionEntry[];
};

const patches = new WeakMap<PatchableSessionManager, PatchState>();

function isChatRender() {
  const stack = new Error().stack;
  return (
    stack?.includes("InteractiveMode.renderInitialMessages") ||
    stack?.includes("InteractiveMode.rebuildChatFromMessages")
  );
}

function installPatch(sessionManager: PatchableSessionManager) {
  const existing = patches.get(sessionManager);
  if (existing) return existing;

  const state: PatchState = {
    originalBuildContextEntries:
      sessionManager.buildContextEntries.bind(sessionManager),
  };

  sessionManager.buildContextEntries = () => {
    const entries = state.originalBuildContextEntries();
    if (!isChatRender()) return entries;
    return entries.filter((entry) => entry.type !== "compaction");
  };

  patches.set(sessionManager, state);
  return state;
}

function hidePersistedSummariesFromChat(ctx: ExtensionContext) {
  if (ctx.mode !== "tui") return;
  installPatch(ctx.sessionManager as PatchableSessionManager);
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    hidePersistedSummariesFromChat(ctx);
  });
}
