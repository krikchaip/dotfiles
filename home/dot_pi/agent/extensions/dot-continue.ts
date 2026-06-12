/**
 * Dot continue/retry prompt.
 *
 * Typing `.` and pressing Enter sends an invisible continue prompt. The hidden
 * entry is physically removed after the turn, with children promoted so history
 * stays clean. If the current leaf is an assistant error, that error subtree is
 * deleted before retrying.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const TRIGGER = ".";
const CONTINUE_PROMPT = "continue";
const CUSTOM_TYPE = "dot-continue";

type Entry = {
  id: string;
  parentId: string | null;
  type: string;
  customType?: string;
  targetId?: string;
  message?: {
    role?: string;
    stopReason?: string;
    errorMessage?: string;
  };
  details?: {
    token?: string;
    cleanup?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type PendingTrigger = {
  token: string;
};

let pendingTrigger: PendingTrigger | undefined;

function entriesOf(sessionManager: any) {
  return (sessionManager.getEntries?.() ?? []) as Entry[];
}

function byId(entries: Entry[]) {
  return new Map(entries.map((entry) => [entry.id, entry]));
}

function nearestKeptParent(
  entry: Entry,
  entriesById: Map<string, Entry>,
  deletedIds: Set<string>,
) {
  let parentId = entry.parentId;
  while (parentId && deletedIds.has(parentId)) {
    parentId = entriesById.get(parentId)?.parentId ?? null;
  }
  return parentId;
}

function collectSubtreeIds(entries: Entry[], rootId: string) {
  const ids = new Set<string>([rootId]);
  let changed = true;

  while (changed) {
    changed = false;
    for (const entry of entries) {
      if (!ids.has(entry.id) && entry.parentId && ids.has(entry.parentId)) {
        ids.add(entry.id);
        changed = true;
      }
    }
  }

  return ids;
}

function collectLinkedLabelIds(entries: Entry[], ids: Set<string>) {
  const result = new Set(ids);
  let changed = true;

  while (changed) {
    changed = false;
    for (const entry of entries) {
      if (entry.type !== "label" || result.has(entry.id)) continue;
      if (entry.targetId && result.has(entry.targetId)) {
        result.add(entry.id);
        changed = true;
      }
    }
  }

  return result;
}

function leafAfterDeletion(
  sessionManager: any,
  root: Entry,
  deletedIds: Set<string>,
  entriesById: Map<string, Entry>,
) {
  const leafId = sessionManager.getLeafId?.() ?? null;
  if (!leafId || !deletedIds.has(leafId)) return leafId;

  const leaf = entriesById.get(leafId);
  return leaf
    ? nearestKeptParent(leaf, entriesById, deletedIds)
    : root.parentId;
}

function commitSessionRewrite(
  sessionManager: any,
  nextEntries: Entry[],
  nextLeafId: string | null,
) {
  sessionManager.fileEntries = nextEntries;
  sessionManager._buildIndex?.();
  sessionManager.leafId = nextLeafId;
  sessionManager._rewriteFile?.();
  if (sessionManager.isPersisted?.()) sessionManager.flushed = true;
}

function deleteSubtree(sessionManager: any, rootId: string) {
  const entries = entriesOf(sessionManager);
  const root = entries.find((entry) => entry.id === rootId);
  if (!root) throw new Error(`Entry ${rootId} not found`);

  const subtreeIds = collectSubtreeIds(entries, rootId);
  const deletedIds = collectLinkedLabelIds(entries, subtreeIds);
  const entriesById = byId(entries);
  const nextLeafId = leafAfterDeletion(
    sessionManager,
    root,
    deletedIds,
    entriesById,
  );
  const nextEntries = sessionManager.fileEntries
    .filter(
      (entry: Entry) => entry.type === "session" || !deletedIds.has(entry.id),
    )
    .map((entry: Entry) => {
      if (
        entry.type === "session" ||
        !entry.parentId ||
        !deletedIds.has(entry.parentId)
      ) {
        return entry;
      }
      return {
        ...entry,
        parentId: nearestKeptParent(entry, entriesById, deletedIds),
      };
    });

  commitSessionRewrite(sessionManager, nextEntries, nextLeafId);

  for (const id of deletedIds) {
    sessionManager.labelsById?.delete?.(id);
    sessionManager.labelTimestampsById?.delete?.(id);
  }
}

function deleteEntryPromoteChildren(sessionManager: any, entryId: string) {
  const entries = entriesOf(sessionManager);
  const target = entries.find((entry) => entry.id === entryId);
  if (!target) return false;

  const deletedIds = collectLinkedLabelIds(entries, new Set([entryId]));
  const nextLeafId =
    sessionManager.getLeafId?.() === entryId
      ? target.parentId
      : (sessionManager.getLeafId?.() ?? null);
  const nextEntries = sessionManager.fileEntries
    .filter(
      (entry: Entry) => entry.type === "session" || !deletedIds.has(entry.id),
    )
    .map((entry: Entry) => {
      if (entry.type === "session" || entry.parentId !== entryId) return entry;
      return { ...entry, parentId: target.parentId };
    });

  commitSessionRewrite(sessionManager, nextEntries, nextLeafId);

  for (const id of deletedIds) {
    sessionManager.labelsById?.delete?.(id);
    sessionManager.labelTimestampsById?.delete?.(id);
  }

  return true;
}

function isAssistantError(entry: Entry | undefined): entry is Entry {
  return (
    entry?.type === "message" &&
    entry.message?.role === "assistant" &&
    (entry.message.stopReason === "error" ||
      Boolean(entry.message.errorMessage))
  );
}

function canContinueFrom(entry: Entry | undefined): entry is Entry {
  return (
    (entry?.type === "message" && entry.message?.role === "assistant") ||
    (entry?.type === "message" && entry.message?.role === "toolResult")
  );
}

function latestContinuableEntry(ctx: ExtensionContext) {
  const branch = ctx.sessionManager.getBranch?.() ?? [];

  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index] as unknown as Entry;
    if (canContinueFrom(entry)) return entry;
  }

  return undefined;
}

function hasImages(event: { images?: unknown[] }) {
  return Array.isArray(event.images) && event.images.length > 0;
}

function latestHiddenTriggerEntry(ctx: ExtensionContext, token: string) {
  const branch = ctx.sessionManager.getBranch?.() ?? [];

  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index] as unknown as Entry;
    if (
      entry.type === "custom_message" &&
      entry.customType === CUSTOM_TYPE &&
      entry.details?.token === token &&
      entry.details?.cleanup === true
    ) {
      return entry;
    }
  }

  return undefined;
}

function sendHiddenContinue(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  mode: "retry" | "continue",
) {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  pendingTrigger = { token };

  pi.sendMessage(
    {
      customType: CUSTOM_TYPE,
      content: CONTINUE_PROMPT,
      display: false,
      details: { token, cleanup: true, mode },
    },
    { triggerTurn: true },
  );

  ctx.ui.notify(mode === "retry" ? "Retrying…" : "Continuing…", "info");
}

function handleDot(pi: ExtensionAPI, ctx: ExtensionContext) {
  if (pendingTrigger) {
    ctx.ui.notify("Dot continue already pending", "warning");
    return;
  }

  if (!ctx.isIdle()) {
    ctx.ui.notify("Cannot dot-continue while agent is running", "warning");
    return;
  }

  const target = latestContinuableEntry(ctx);

  if (isAssistantError(target)) {
    try {
      deleteEntryPromoteChildren(ctx.sessionManager, target.id);
    } catch (error) {
      ctx.ui.notify(
        error instanceof Error ? error.message : String(error),
        "error",
      );
      return;
    }

    sendHiddenContinue(pi, ctx, "retry");
    return;
  }

  if (!target) {
    ctx.ui.notify("Nothing to continue", "warning");
    return;
  }

  sendHiddenContinue(pi, ctx, "continue");
}

export default function (pi: ExtensionAPI) {
  pi.on("input", (event, ctx) => {
    if (event.source !== "interactive") return { action: "continue" };
    if (event.text.trim() !== TRIGGER) return { action: "continue" };
    if (hasImages(event)) return { action: "continue" };

    handleDot(pi, ctx);
    return { action: "handled" };
  });

  pi.on("agent_end", (_event, ctx) => {
    const token = pendingTrigger?.token;
    if (!token) return;

    const entry = latestHiddenTriggerEntry(ctx, token);
    pendingTrigger = undefined;

    if (!entry) return;

    try {
      deleteEntryPromoteChildren(ctx.sessionManager, entry.id);
    } catch (error) {
      ctx.ui.notify(
        error instanceof Error ? error.message : String(error),
        "error",
      );
    }
  });

  pi.on("session_start", () => {
    pendingTrigger = undefined;
  });

  pi.on("session_shutdown", () => {
    pendingTrigger = undefined;
  });
}
