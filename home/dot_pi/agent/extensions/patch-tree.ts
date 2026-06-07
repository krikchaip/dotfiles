/**
 * Patch /tree.
 *
 * Adds Alt+D subtree deletion mode to the native tree selector.
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
const TREE_DELETE_PATCH_VERSION = 5;

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

type DeleteState = {
  mode: boolean;
  confirmation: DeleteConfirmation | null;
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
  showError?: (message: string) => void;
  showExtensionCustom?: <T>(
    factory: (
      tui: any,
      theme: any,
      keybindings: any,
      done: (value: T) => void,
    ) => any,
    options?: any,
  ) => Promise<T>;
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

function framedLine(theme: any, content: string, width: number) {
  const innerWidth = Math.max(0, width - 4);
  const body = truncateToWidth(content, innerWidth, "…");
  const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(body)));
  return [theme.fg("error", "│ "), body, padding, theme.fg("error", " │")].join(
    "",
  );
}

function frameBorder(theme: any, width: number, side: "top" | "bottom") {
  const left = side === "top" ? "╭" : "╰";
  const right = side === "top" ? "╮" : "╯";
  return theme.fg(
    "error",
    `${left}${"─".repeat(Math.max(0, width - 2))}${right}`,
  );
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

  return { deletedIds: ids, nextLeafId, focusId: root.parentId ?? nextLeafId };
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
  treeList.buildActivePath?.();
  treeList.applyFilter?.();
}

function targetIdsFor(treeList: any, state: DeleteState) {
  const id = state.confirmation?.rootId ?? selectedEntryId(treeList);
  if (!id) return new Set<string>();

  const entries = treeList.flatNodes.map(
    (flatNode: any) => flatNode.node.entry,
  );
  return new Set([
    ...collectDeletionIds(entries, id),
    ...collectVisualSubtreeIds(treeList, id),
  ]);
}

function performDeletion(
  treeList: any,
  interactiveMode: PatchedInteractiveMode,
  confirmation: DeleteConfirmation,
) {
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
  } catch (error) {
    interactiveMode.showError?.(
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function showDeleteDialog(
  interactiveMode: PatchedInteractiveMode,
  confirmation: DeleteConfirmation,
  _theme: any,
  keyHint: (id: string, description: string) => string,
) {
  if (!interactiveMode.showExtensionCustom) return false;

  return interactiveMode.showExtensionCustom<boolean>(
    (_tui, dialogTheme, keybindings, done) => ({
      invalidate() {},
      handleInput(data: string) {
        if (keybindings.matches(data, "tui.select.confirm")) {
          done(true);
        } else if (keybindings.matches(data, "tui.select.cancel")) {
          done(false);
        }
      },
      render(width: number) {
        const parts =
          confirmation.stats.parts.length > 0
            ? confirmation.stats.parts
            : ["none"];
        const title = dialogTheme.fg(
          "error",
          dialogTheme.bold(
            `Delete selected subtree? ${confirmation.stats.total} node${confirmation.stats.total === 1 ? "" : "s"}`,
          ),
        );
        const help = dialogTheme.fg(
          "muted",
          `${keyHint("tui.select.confirm", "confirm")} · ${keyHint("tui.select.cancel", "cancel")}`,
        );

        return [
          truncateToWidth(frameBorder(dialogTheme, width, "top"), width),
          truncateToWidth(framedLine(dialogTheme, title, width), width),
          truncateToWidth(framedLine(dialogTheme, "", width), width),
          ...parts.map((part) =>
            truncateToWidth(
              framedLine(
                dialogTheme,
                renderStatsPart(dialogTheme, part),
                width,
              ),
              width,
            ),
          ),
          truncateToWidth(framedLine(dialogTheme, "", width), width),
          truncateToWidth(framedLine(dialogTheme, help, width), width),
          truncateToWidth(frameBorder(dialogTheme, width, "bottom"), width),
        ];
      },
    }),
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: "70%",
        minWidth: 50,
        margin: 2,
      },
    },
  );
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

    if (state.confirmation) return;

    if (matchesKey(keyData, "alt+d")) {
      state.mode = !state.mode;
      state.confirmation = null;
      interactiveMode.ui?.requestRender?.();
      return;
    }

    if (state.mode && kb.matches(keyData, "tui.select.cancel")) {
      state.mode = false;
      interactiveMode.ui?.requestRender?.();
      return;
    }

    if (state.mode && kb.matches(keyData, "tui.select.confirm")) {
      const rootId = selectedEntryId(treeList);
      if (!rootId) return;
      const entries = interactiveMode.sessionManager.getEntries?.() as Entry[];
      const ids = collectDeletionIds(entries, rootId);
      const confirmation = {
        rootId,
        ids,
        stats: statsFor(entries, ids),
      };
      state.confirmation = confirmation;
      interactiveMode.ui?.requestRender?.();

      void (async () => {
        const confirmed = await showDeleteDialog(
          interactiveMode,
          confirmation,
          theme,
          keyHint,
        );
        if (state.confirmation !== confirmation) return;

        if (!confirmed) {
          state.confirmation = null;
          interactiveMode.ui?.requestRender?.();
          return;
        }

        state.mode = false;
        state.confirmation = null;
        performDeletion(treeList, interactiveMode, confirmation);
        interactiveMode.ui?.requestRender?.();
      })();
      return;
    }

    originalHandleInput(keyData);
    if (state.mode) interactiveMode.ui?.requestRender?.();
  };

  treeList.render = function (width: number) {
    const lines = originalRender(width);
    if (!state.mode && !state.confirmation) return lines;

    const ids = targetIdsFor(treeList, state);
    if (ids.size === 0) return lines;

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
      if (!ids.has(flatNode.node.entry.id)) continue;

      const lineIndex = index - startIndex;
      const plain = stripAnsi(lines[lineIndex] ?? "");
      lines[lineIndex] = truncateToWidth(
        index === treeList.selectedIndex
          ? theme.bg("selectedBg", theme.fg("error", theme.bold(plain)))
          : theme.fg("error", plain),
        width,
      );
    }

    return lines;
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
  const state: DeleteState = { mode: false, confirmation: null };
  patchTreeList(treeList, state, interactiveMode, theme, keyHint);

  const originalRender = selector.render.bind(selector);
  selector.render = function (width: number) {
    const lines = originalRender(width);
    const headingIndex = lines.findIndex((line: string) =>
      stripAnsi(line).includes("Session Tree"),
    );

    if (headingIndex >= 0) {
      const title =
        state.mode || state.confirmation
          ? theme.fg("error", theme.bold("  Session Tree — DELETE MODE"))
          : theme.bold("  Session Tree");
      lines[headingIndex] = truncateToWidth(title, width);
    }

    let hintIndex = lines.findIndex((line: string) =>
      stripAnsi(line).includes("filters"),
    );
    if (hintIndex < 0 && headingIndex >= 0 && lines[headingIndex + 1]) {
      hintIndex = headingIndex + 1;
    }

    if (hintIndex >= 0) {
      const sep = theme.fg("muted", " · ");
      const suffix = sep + rawKeyHint("alt+d", state.mode ? "exit" : "delete");
      const base =
        state.mode || state.confirmation
          ? "  " +
            [
              keyHint("tui.select.confirm", "review"),
              keyHint("tui.select.cancel", "cancel"),
              theme.fg("muted", "move/filter/fold OK"),
            ].join(sep)
          : lines[hintIndex];
      const hint =
        truncateToWidth(base, Math.max(0, width - visibleWidth(suffix)), "…") +
        suffix;
      lines[hintIndex] = truncateToWidth(hint, width);
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
  const patchState = proto[TREE_DELETE_PATCHED];

  if (patchState?.version === TREE_DELETE_PATCH_VERSION) return;

  const originalShowTreeSelector =
    patchState?.originalShowTreeSelector ?? proto.showTreeSelector;

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

  proto[TREE_DELETE_PATCHED] = {
    version: TREE_DELETE_PATCH_VERSION,
    originalShowTreeSelector,
  };
}
