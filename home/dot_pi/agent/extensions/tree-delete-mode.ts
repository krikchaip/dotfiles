/**
 * Tree deletion mode for /tree.
 *
 * Adds Alt+D mode to preview deletion of the selected subtree.
 * Highlights affected tree nodes, shows deletion stats, deletes linked labels,
 * rewrites the session file, and moves the active leaf to the nearest kept parent.
 */

import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  getKeybindings,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

const TREE_DELETE_PATCHED = "__treeDeletePatched";

type Entry = {
  id: string;
  parentId: string | null;
  type: string;
  message?: { role?: string };
  [key: string]: any;
};

type DeleteStats = {
  total: number;
  parts: Array<{ kind: string; count: number }>;
};

type DeleteConfirmation = {
  rootId: string;
  ids: Set<string>;
  stats: DeleteStats;
};

type DeletePreview = {
  rootId: string;
  targetIds: Set<string>;
  confirmation: DeleteConfirmation;
};

type DeleteState = {
  mode: boolean;
  preview: DeletePreview | null;
};

type PatchedInteractiveMode = {
  showTreeSelector(initialSelectedId?: string): void;
  showSelector(factory: (done: () => void) => any): any;
  sessionManager: any;
  ui?: any;
  editor?: any;
  chatContainer?: any;
  renderInitialMessages?: () => void;
  showStatus?: (message: string) => void;
  showWarning?: (message: string) => void;
  showError?: (message: string) => void;
  session?: { isStreaming?: boolean };
  [key: string]: any;
};

function stripAnsi(value: string) {
  return value.replace(
    /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    "",
  );
}

function selectedEntryId(treeList: any) {
  return treeList.filteredNodes?.[treeList.selectedIndex]?.node?.entry?.id;
}

function entryKind(entry: Entry) {
  if (entry.type === "message") {
    return entry.message?.role ?? "message";
  }
  return entry.type.replace(/_/g, "-");
}

function kindColor(kind: string) {
  switch (kind) {
    case "user":
      return "accent";
    case "assistant":
      return "success";
    case "branch-summary":
      return "warning";
    case "compaction":
      return "borderAccent";
    case "custom-message":
      return "customMessageLabel";
    case "toolResult":
      return "muted";
    case "bashExecution":
    case "model-change":
    case "thinking-level-change":
    case "session-info":
    case "custom":
    case "label":
      return "dim";
    default:
      return "muted";
  }
}

function renderStatsPart(
  theme: any,
  part: { kind: string; count: number } | string,
) {
  if (typeof part === "string") return theme.fg("muted", part);
  return [
    theme.fg(kindColor(part.kind), `${part.kind}:`),
    theme.fg("text", ` ${part.count}`),
  ].join("");
}

function appendHintIfFits(
  base: string,
  hint: string,
  width: number,
  separator: string,
) {
  const line = base + separator + hint;
  return visibleWidth(line) <= width ? line : base;
}

function statsFor(entries: Entry[], ids: Set<string>): DeleteStats {
  const counts = new Map<string, number>();
  let total = 0;

  for (const entry of entries) {
    if (!ids.has(entry.id)) continue;
    total++;
    const kind = entryKind(entry);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }

  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([kind, count]) => ({ kind, count }));

  return { total, parts };
}

function collectSubtreeIds(entries: Entry[], rootId: string) {
  const childrenByParent = new Map<string, Entry[]>();
  for (const entry of entries) {
    if (!entry.parentId) continue;
    const children = childrenByParent.get(entry.parentId) ?? [];
    children.push(entry);
    childrenByParent.set(entry.parentId, children);
  }

  const ids = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || ids.has(id)) continue;
    ids.add(id);
    for (const child of childrenByParent.get(id) ?? []) {
      stack.push(child.id);
    }
  }

  return ids;
}

function collectVisualSubtreeIds(treeList: any, rootId: string) {
  const root = treeList.flatNodes?.find(
    (flatNode: any) => flatNode.node.entry.id === rootId,
  )?.node;
  const ids = new Set<string>();
  const stack = root ? [root] : [];

  while (stack.length > 0) {
    const node = stack.pop();
    const id = node?.entry?.id;
    if (!id || ids.has(id)) continue;
    ids.add(id);
    for (const child of node.children ?? []) {
      stack.push(child);
    }
  }

  return ids;
}

function collectDeletionIds(entries: Entry[], rootId: string) {
  const ids = collectSubtreeIds(entries, rootId);
  let changed = true;

  while (changed) {
    changed = false;
    for (const entry of entries) {
      if (entry.type !== "label" || ids.has(entry.id)) continue;
      if (entry.targetId && ids.has(entry.targetId)) {
        ids.add(entry.id);
        changed = true;
      }
    }
  }

  return ids;
}

function nearestKeptParent(
  entry: Entry,
  byId: Map<string, Entry>,
  deletedIds: Set<string>,
) {
  let parentId = entry.parentId;
  while (parentId && deletedIds.has(parentId)) {
    parentId = byId.get(parentId)?.parentId ?? null;
  }
  return parentId;
}

function activeLeafAfterDeletion(
  sessionManager: any,
  root: Entry,
  ids: Set<string>,
  byId: Map<string, Entry>,
) {
  const leafId = sessionManager.getLeafId?.() ?? null;
  if (!leafId || !ids.has(leafId)) return leafId;

  const leaf = byId.get(leafId);
  return leaf ? nearestKeptParent(leaf, byId, ids) : (root.parentId ?? null);
}

function deleteSubtree(sessionManager: any, rootId: string) {
  const entries = sessionManager.getEntries?.() as Entry[];
  const root = entries.find((entry) => entry.id === rootId);
  if (!root) throw new Error(`Entry ${rootId} not found`);

  const ids = collectDeletionIds(entries, rootId);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const nextLeafId = activeLeafAfterDeletion(sessionManager, root, ids, byId);

  sessionManager.fileEntries = sessionManager.fileEntries
    .filter((entry: Entry) => entry.type === "session" || !ids.has(entry.id))
    .map((entry: Entry) => {
      if (
        entry.type === "session" ||
        !entry.parentId ||
        !ids.has(entry.parentId)
      ) {
        return entry;
      }
      return { ...entry, parentId: nearestKeptParent(entry, byId, ids) };
    });
  sessionManager._buildIndex?.();
  sessionManager.leafId = nextLeafId;
  sessionManager._rewriteFile?.();
  if (sessionManager.isPersisted?.()) sessionManager.flushed = true;

  for (const id of ids) {
    sessionManager.labelsById?.delete?.(id);
    sessionManager.labelTimestampsById?.delete?.(id);
  }

  return { deletedIds: ids, nextLeafId, focusId: nextLeafId };
}

function updateTreeListAfterDeletion(
  treeList: any,
  sessionManager: any,
  deletedIds: Set<string>,
  nextLeafId: string | null,
  focusId: string | null,
) {
  treeList.currentLeafId = nextLeafId;
  treeList.lastSelectedId = focusId;
  treeList.foldedNodes = new Set(
    [...(treeList.foldedNodes ?? [])].filter((id) => !deletedIds.has(id)),
  );
  treeList.flatNodes =
    treeList.flattenTree?.(sessionManager.getTree?.() ?? []) ?? [];
  treeList.filteredNodes = [];
  treeList.buildActivePath?.();
  treeList.applyFilter?.();
}

function canDeleteNow(interactiveMode: PatchedInteractiveMode) {
  if (interactiveMode.session?.isStreaming !== true) return true;

  const message = "Cannot delete tree nodes while streaming";
  if (interactiveMode.showWarning) {
    interactiveMode.showWarning(message);
  } else {
    interactiveMode.showStatus?.(message);
  }
  return false;
}

function performDeletion(
  treeList: any,
  interactiveMode: PatchedInteractiveMode,
  confirmation: DeleteConfirmation,
) {
  if (!canDeleteNow(interactiveMode)) return false;

  try {
    const result = deleteSubtree(
      interactiveMode.sessionManager,
      confirmation.rootId,
    );
    updateTreeListAfterDeletion(
      treeList,
      interactiveMode.sessionManager,
      result.deletedIds,
      result.nextLeafId,
      result.focusId,
    );
    interactiveMode.chatContainer?.clear?.();
    interactiveMode.renderInitialMessages?.();
    interactiveMode.editor?.setText?.("");
    interactiveMode.showStatus?.(
      `Deleted ${confirmation.stats.total} tree node${confirmation.stats.total === 1 ? "" : "s"}`,
    );
    return true;
  } catch (error) {
    interactiveMode.showError?.(
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

function previewForSelection(
  treeList: any,
  interactiveMode: PatchedInteractiveMode,
  state: DeleteState,
) {
  const rootId = selectedEntryId(treeList);
  if (!rootId) return null;
  if (state.preview?.rootId === rootId) return state.preview;

  const entries = (interactiveMode.sessionManager.getEntries?.() ??
    []) as Entry[];
  const ids = collectDeletionIds(entries, rootId);
  const targetIds = new Set([
    ...ids,
    ...collectVisualSubtreeIds(treeList, rootId),
  ]);
  const preview = {
    rootId,
    targetIds,
    confirmation: {
      rootId,
      ids,
      stats: statsFor(entries, ids),
    },
  };
  state.preview = preview;
  return preview;
}

function renderDeleteSummary(
  theme: any,
  width: number,
  confirmation: DeleteConfirmation,
  keyHint: (id: string, description: string) => string,
) {
  const parts =
    confirmation.stats.parts.length > 0 ? confirmation.stats.parts : ["none"];
  const title = [
    theme.fg("error", theme.bold("  Delete review")),
    theme.fg(
      "muted",
      ` selected subtree: ${confirmation.stats.total} node${confirmation.stats.total === 1 ? "" : "s"} · `,
    ),
    theme.fg(
      "error",
      theme.bold(stripAnsi(keyHint("tui.select.confirm", "delete"))),
    ),
    theme.fg("muted", " · "),
    keyHint("tui.select.cancel", "cancel"),
  ].join("");
  const stats =
    "  " +
    parts
      .map((part) => renderStatsPart(theme, part))
      .join(theme.fg("muted", " · "));

  return ["", truncateToWidth(title, width), truncateToWidth(stats, width), ""];
}

function insertBeforeTreeStatus(lines: string[], extraLines: string[]) {
  const result = [...lines];
  let statusIndex = -1;

  for (let index = result.length - 1; index >= 0; index--) {
    if (/^\s*\(\d+\/\d+\)/.test(stripAnsi(result[index]))) {
      statusIndex = index;
      break;
    }
  }

  if (statusIndex >= 0) {
    result.splice(statusIndex, 0, ...extraLines);
  } else {
    result.push(...extraLines);
  }

  return result;
}

function patchTreeList(
  treeList: any,
  state: DeleteState,
  interactiveMode: PatchedInteractiveMode,
  theme: any,
  keyHint: (id: string, description: string) => string,
) {
  if (treeList.__treeDeletePatched) return;
  treeList.__treeDeletePatched = true;

  const originalHandleInput = treeList.handleInput.bind(treeList);
  const originalRender = treeList.render.bind(treeList);

  treeList.handleInput = function (keyData: string) {
    const kb = getKeybindings();

    if (matchesKey(keyData, "alt+d")) {
      state.mode = !state.mode;
      state.preview = null;
      interactiveMode.ui?.requestRender?.();
      return;
    }

    if (state.mode && kb.matches(keyData, "tui.select.cancel")) {
      state.mode = false;
      state.preview = null;
      interactiveMode.ui?.requestRender?.();
      return;
    }

    if (state.mode && kb.matches(keyData, "tui.select.confirm")) {
      const preview = previewForSelection(treeList, interactiveMode, state);
      if (!preview) return;

      const deleted = performDeletion(
        treeList,
        interactiveMode,
        preview.confirmation,
      );
      if (deleted) state.mode = false;
      state.preview = null;
      interactiveMode.ui?.requestRender?.();
      return;
    }

    originalHandleInput(keyData);
    if (state.mode) interactiveMode.ui?.requestRender?.();
  };

  treeList.render = function (width: number) {
    const lines = originalRender(width);
    if (!state.mode) return lines;

    const preview = previewForSelection(treeList, interactiveMode, state);
    if (!preview || preview.targetIds.size === 0) return lines;

    const startIndex = Math.max(
      0,
      Math.min(
        treeList.selectedIndex - Math.floor(treeList.maxVisibleLines / 2),
        treeList.filteredNodes.length - treeList.maxVisibleLines,
      ),
    );
    const endIndex = Math.min(
      startIndex + treeList.maxVisibleLines,
      treeList.filteredNodes.length,
    );

    for (let index = startIndex; index < endIndex; index++) {
      const flatNode = treeList.filteredNodes[index];
      if (!preview.targetIds.has(flatNode.node.entry.id)) continue;

      const lineIndex = index - startIndex;
      const plain = stripAnsi(lines[lineIndex] ?? "");
      lines[lineIndex] = truncateToWidth(
        index === treeList.selectedIndex
          ? theme.bg("selectedBg", theme.fg("error", theme.bold(plain)))
          : theme.fg("error", plain),
        width,
      );
    }

    return insertBeforeTreeStatus(
      lines,
      renderDeleteSummary(theme, width, preview.confirmation, keyHint),
    );
  };
}

function patchTreeSelector(
  selector: any,
  interactiveMode: PatchedInteractiveMode,
  theme: any,
  keyHint: (id: string, description: string) => string,
  rawKeyHint: (key: string, description: string) => string,
) {
  const treeList = selector?.getTreeList?.();
  if (!treeList || selector.__treeDeletePatched) return;

  selector.__treeDeletePatched = true;
  const state: DeleteState = { mode: false, preview: null };
  patchTreeList(treeList, state, interactiveMode, theme, keyHint);

  const originalRender = selector.render.bind(selector);
  selector.render = function (width: number) {
    const lines = originalRender(width);
    const headingIndex = lines.findIndex((line: string) =>
      stripAnsi(line).includes("Session Tree"),
    );

    if (headingIndex >= 0) {
      const title = state.mode
        ? theme.fg("error", theme.bold("  Session Tree — DELETE MODE"))
        : theme.bold("  Session Tree");
      lines[headingIndex] = truncateToWidth(title, width);
    }

    const searchIndex = lines.findIndex((line: string) =>
      stripAnsi(line).includes("Type to search:"),
    );

    if (state.mode && headingIndex >= 0 && searchIndex > headingIndex) {
      const sep = theme.fg("muted", " · ");
      const preview = previewForSelection(treeList, interactiveMode, state);
      const confirmText = preview
        ? `delete ${preview.confirmation.stats.total} node${preview.confirmation.stats.total === 1 ? "" : "s"}`
        : "delete";
      const confirmHint = theme.fg(
        "error",
        theme.bold(stripAnsi(keyHint("tui.select.confirm", confirmText))),
      );
      const hints = [
        [
          "  " + confirmHint,
          keyHint("tui.select.cancel", "cancel"),
          theme.fg("muted", "move/filter/fold OK"),
          rawKeyHint("alt+d", "exit"),
        ].join(sep),
      ];
      lines.splice(
        headingIndex + 1,
        searchIndex - headingIndex - 1,
        ...hints.map((hint) => truncateToWidth(hint, width)),
      );
    } else {
      let hintIndex = lines.findIndex((line: string) =>
        stripAnsi(line).includes("filters"),
      );
      if (hintIndex < 0 && headingIndex >= 0 && lines[headingIndex + 1]) {
        hintIndex = headingIndex + 1;
      }

      if (hintIndex >= 0) {
        lines[hintIndex] = truncateToWidth(
          appendHintIfFits(
            lines[hintIndex],
            rawKeyHint("alt+d", "delete"),
            width,
            theme.fg("muted", " · "),
          ),
          width,
        );
      }
    }

    return lines.map((line: string) => truncateToWidth(line, width));
  };
}

export default function (_pi: ExtensionAPI) {
  const req = createRequire(__filename);
  const cliPath = realpathSync(process.argv[1]);
  const distPath = dirname(cliPath);

  const { InteractiveMode } = req(
    join(distPath, "modes", "interactive", "interactive-mode.js"),
  );
  const { theme } = req(
    join(distPath, "modes", "interactive", "theme", "theme.js"),
  );
  const { keyHint, rawKeyHint } = req(
    join(distPath, "modes", "interactive", "components", "keybinding-hints.js"),
  );

  const proto = InteractiveMode.prototype as PatchedInteractiveMode;
  if (proto[TREE_DELETE_PATCHED]) return;

  const originalShowTreeSelector = proto.showTreeSelector;

  proto.showTreeSelector = function (
    this: PatchedInteractiveMode,
    initialSelectedId?: string,
  ) {
    const originalShowSelector = this.showSelector;

    this.showSelector = function (
      this: PatchedInteractiveMode,
      factory: (done: () => void) => any,
    ) {
      return originalShowSelector.call(this, (done: () => void) => {
        const result = factory(done);
        patchTreeSelector(result?.component, this, theme, keyHint, rawKeyHint);
        return result;
      });
    };

    try {
      return originalShowTreeSelector.call(this, initialSelectedId);
    } finally {
      if (Object.prototype.hasOwnProperty.call(this, "showSelector")) {
        delete (this as any).showSelector;
      }
    }
  };

  proto[TREE_DELETE_PATCHED] = true;
}
