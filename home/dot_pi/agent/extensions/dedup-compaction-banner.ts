/**
 * Shows compaction summaries only at the bottom.
 *
 * Pi persists each compaction entry, then renders it at the active-context
 * boundary. On reopening a compacted session, Pi also shows a top status banner.
 * This extension suppresses the top status banner, moves the active compaction
 * card to its chronological transcript position, and omits Pi's immediate
 * duplicate after a live compaction.
 */

import {
  InteractiveMode,
  type ExtensionAPI,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";

const PATCH_STATE = "__dedupCompactionBannerPatchState";

type RenderOptions = {
  updateFooter?: boolean;
  populateHistory?: boolean;
};

type PatchableSessionManager = {
  getEntries(): SessionEntry[];
};

type ChatMessage = {
  role: string;
  summary?: string;
  tokensBefore?: number;
};

type PatchedInteractiveMode = {
  sessionManager: PatchableSessionManager;
  addMessageToChat(message: ChatMessage, options?: unknown): unknown;
  renderInitialMessages(): void;
  renderSessionEntries(entries: SessionEntry[], options?: RenderOptions): void;
  [PATCH_STATE]?: PatchState;
};

type PatchState = {
  originalAddMessageToChat: PatchedInteractiveMode["addMessageToChat"];
  originalRenderInitialMessages: PatchedInteractiveMode["renderInitialMessages"];
  originalRenderSessionEntries: PatchedInteractiveMode["renderSessionEntries"];
};

type RenderedCompaction = {
  summary: string;
  tokensBefore: number;
};

const renderedCompactions = new WeakMap<
  PatchedInteractiveMode,
  RenderedCompaction
>();

function withoutCompactions(entries: SessionEntry[]): SessionEntry[] {
  return entries.filter((entry) => entry.type !== "compaction");
}

function placeCompactionAtEvent(entries: SessionEntry[]) {
  const compaction = entries.find((entry) => entry.type === "compaction");
  if (!compaction) return entries;

  const timeline = withoutCompactions(entries);
  const parentIndex = timeline.findIndex(
    (entry) => entry.id === compaction.parentId,
  );
  if (parentIndex >= 0) {
    timeline.splice(parentIndex + 1, 0, compaction);
    return timeline;
  }

  const childIndex = timeline.findIndex(
    (entry) => entry.parentId === compaction.id,
  );
  if (childIndex >= 0) {
    timeline.splice(childIndex, 0, compaction);
    return timeline;
  }

  const compactionTime = Date.parse(compaction.timestamp);
  const newerIndex = timeline.findIndex(
    (entry) => Date.parse(entry.timestamp) > compactionTime,
  );
  timeline.splice(newerIndex < 0 ? timeline.length : newerIndex, 0, compaction);
  return timeline;
}

function isRepeatedCompaction(
  previous: RenderedCompaction | undefined,
  message: ChatMessage,
) {
  return (
    previous !== undefined &&
    previous.summary === message.summary &&
    previous.tokensBefore === message.tokensBefore
  );
}

function installPatch(InteractiveMode: { prototype: PatchedInteractiveMode }) {
  const prototype = InteractiveMode.prototype;
  if (prototype[PATCH_STATE]) return;

  if (typeof prototype.addMessageToChat !== "function") {
    throw new Error("InteractiveMode.addMessageToChat unavailable");
  }
  if (typeof prototype.renderInitialMessages !== "function") {
    throw new Error("InteractiveMode.renderInitialMessages unavailable");
  }
  if (typeof prototype.renderSessionEntries !== "function") {
    throw new Error("InteractiveMode.renderSessionEntries unavailable");
  }

  const state: PatchState = {
    originalAddMessageToChat: prototype.addMessageToChat,
    originalRenderInitialMessages: prototype.renderInitialMessages,
    originalRenderSessionEntries: prototype.renderSessionEntries,
  };
  prototype[PATCH_STATE] = state;

  prototype.addMessageToChat = function (
    this: PatchedInteractiveMode,
    message: ChatMessage,
    options?: unknown,
  ) {
    if (
      message.role === "compactionSummary" &&
      isRepeatedCompaction(renderedCompactions.get(this), message)
    ) {
      return;
    }

    const result = state.originalAddMessageToChat.call(this, message, options);
    if (
      message.role === "compactionSummary" &&
      typeof message.summary === "string" &&
      typeof message.tokensBefore === "number"
    ) {
      renderedCompactions.set(this, {
        summary: message.summary,
        tokensBefore: message.tokensBefore,
      });
    }
    return result;
  };

  prototype.renderSessionEntries = function (
    this: PatchedInteractiveMode,
    entries: SessionEntry[],
    options?: RenderOptions,
  ) {
    renderedCompactions.delete(this);
    return state.originalRenderSessionEntries.call(
      this,
      placeCompactionAtEvent(entries),
      options,
    );
  };

  prototype.renderInitialMessages = function (this: PatchedInteractiveMode) {
    const sessionManager = this.sessionManager;
    const originalGetEntries = sessionManager.getEntries;
    const getEntriesWithoutCompactions = function (
      this: PatchableSessionManager,
    ) {
      return withoutCompactions(originalGetEntries.call(this));
    };

    sessionManager.getEntries = getEntriesWithoutCompactions;
    try {
      state.originalRenderInitialMessages.call(this);
    } finally {
      if (sessionManager.getEntries === getEntriesWithoutCompactions) {
        sessionManager.getEntries = originalGetEntries;
      }
    }
  };
}

export default function (_pi: ExtensionAPI) {
  installPatch(
    InteractiveMode as unknown as { prototype: PatchedInteractiveMode },
  );
}
