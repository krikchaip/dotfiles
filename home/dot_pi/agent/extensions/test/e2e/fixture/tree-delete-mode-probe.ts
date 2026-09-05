import { readFileSync, writeFileSync } from "node:fs";
import { InteractiveMode, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";

const stripAnsi = (value: string) =>
  value.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, "");
const proto = InteractiveMode.prototype as any;

function entries() {
  return [
    { type: "session", version: 3, id: "session", cwd: "/tmp" },
    { type: "message", id: "root", parentId: null, message: { role: "user" } },
    { type: "message", id: "delete-root", parentId: "root", message: { role: "assistant" } },
    { type: "custom_message", id: "delete-child", parentId: "delete-root" },
    { type: "label", id: "linked-label", parentId: "root", targetId: "delete-child", label: "linked" },
    { type: "message", id: "sibling", parentId: "root", message: { role: "user" } },
  ];
}

function makeMode(streaming: boolean, persistPath: string, failRewrite = false) {
  const statuses: string[] = [];
  const warnings: string[] = [];
  const initialEntries = entries();
  writeFileSync(persistPath, `${initialEntries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  const manager: any = {
    fileEntries: initialEntries,
    leafId: "delete-child",
    labelsById: new Map([["delete-child", "linked"]]),
    labelTimestampsById: new Map([["delete-child", 1]]),
    getEntries() { return this.fileEntries.filter((entry: any) => entry.type !== "session"); },
    getLeafId() { return this.leafId; },
    isPersisted() { return true; },
    _buildIndex() {},
    _rewriteFile() {
      if (failRewrite) throw new Error("E2E forced rewrite failure");
      writeFileSync(
        persistPath,
        `${this.fileEntries.map((entry: unknown) => JSON.stringify(entry)).join("\n")}\n`,
      );
    },
    getTree() {
      const byId = new Map<string, any>();
      const roots: any[] = [];
      for (const entry of this.getEntries()) {
        if (entry.type === "label") continue;
        byId.set(entry.id, { entry, children: [] });
      }
      for (const node of byId.values()) {
        const parent = node.entry.parentId ? byId.get(node.entry.parentId) : undefined;
        if (parent) parent.children.push(node); else roots.push(node);
      }
      return roots;
    },
  };
  const mode: any = {
    sessionManager: manager,
    session: { isStreaming: streaming },
    ui: { requestRender() {} },
    editor: { setText() {} },
    chatContainer: { clear() {} },
    renderInitialMessages() {},
    showStatus(value: string) { statuses.push(value); },
    showWarning(value: string) { warnings.push(value); },
    showError(value: string) { throw new Error(value); },
    showSelector(factory: () => unknown) { return factory(); },
  };
  return {
    mode,
    manager,
    statuses,
    warnings,
    initialFileBytes: readFileSync(persistPath, "utf8"),
  };
}

function flatten(nodes: any[]): any[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

proto.showTreeSelector = function controlledTreeSelector(this: any) {
  const makeFlat = () => flatten(this.sessionManager.getTree()).map((node) => ({ node }));
  const treeList: any = {
    currentLeafId: this.sessionManager.getLeafId(),
    lastSelectedId: "delete-root",
    selectedIndex: 1,
    maxVisibleLines: 20,
    foldedNodes: new Set(),
    flatNodes: makeFlat(),
    filteredNodes: makeFlat(),
    buildActivePath() {},
    flattenTree(nodes: any[]) { return flatten(nodes).map((node) => ({ node })); },
    applyFilter() {
      this.filteredNodes = this.flatNodes;
      const selected = this.filteredNodes.findIndex((item: any) => item.node.entry.id === this.lastSelectedId);
      this.selectedIndex = Math.max(0, selected);
    },
    handleInput(data: string) {
      if (matchesKey(data, "escape")) this.cancelled = true;
    },
    render(width: number) {
      return [
        ...this.filteredNodes.map((item: any) => `  NODE ${item.node.entry.id}`),
        `  (${this.selectedIndex + 1}/${this.filteredNodes.length})`,
      ].map((line) => line.slice(0, width));
    },
  };
  const selector: any = {
    getTreeList: () => treeList,
    render(width: number) {
      return ["  Session Tree", "  ↑↓ filters", "  Type to search:", ...treeList.render(width)];
    },
  };
  this.lastTreeList = treeList;
  this.lastSelector = selector;
  return this.showSelector(() => ({ component: selector }));
};

export default function treeDeleteModeProbe(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, context) => {
    const path = process.env.PI_E2E_TREE_DELETE_CAPTURE;
    if (!path) throw new Error("PI_E2E_TREE_DELETE_CAPTURE is required");

    const cancelPath = `${path}.cancel.jsonl`;
    const deletionPath = `${path}.delete.jsonl`;
    const streamingPath = `${path}.streaming.jsonl`;
    const cancelled = makeMode(false, cancelPath);
    proto.showTreeSelector.call(cancelled.mode);
    cancelled.mode.lastTreeList.handleInput("\x1bd");
    const narrow = cancelled.mode.lastSelector.render(32);
    const narrowPlain = narrow.map(stripAnsi);
    cancelled.mode.lastTreeList.handleInput("\x1b");
    const cancelBytes = JSON.stringify(cancelled.manager.fileEntries);

    const deletion = makeMode(false, deletionPath);
    proto.showTreeSelector.call(deletion.mode);
    deletion.mode.lastTreeList.handleInput("\x1bd");
    const previewFirst = deletion.mode.lastSelector.render(42).map(stripAnsi);
    const previewSecond = deletion.mode.lastSelector.render(42).map(stripAnsi);
    deletion.mode.lastTreeList.handleInput("\r");

    const streaming = makeMode(true, streamingPath);
    proto.showTreeSelector.call(streaming.mode);
    const streamingBefore = JSON.stringify(streaming.manager.fileEntries);
    streaming.mode.lastTreeList.handleInput("\x1bd");
    streaming.mode.lastTreeList.handleInput("\r");

    const failurePath = `${path}.failure.jsonl`;
    const failed = makeMode(false, failurePath, true);
    const failureBefore = JSON.stringify(failed.manager.fileEntries);
    let failureError = "";
    proto.showTreeSelector.call(failed.mode);
    failed.mode.lastTreeList.handleInput("\x1bd");
    try {
      failed.mode.lastTreeList.handleInput("\r");
    } catch (error) {
      failureError = error instanceof Error ? error.message : String(error);
    }

    writeFileSync(path, JSON.stringify({
      narrowPlain,
      narrowWidths: narrow.map((line: string) => visibleWidth(line)),
      cancelBytes,
      cancelInitialFileBytes: cancelled.initialFileBytes,
      cancelFileBytes: readFileSync(cancelPath, "utf8"),
      expectedBytes: JSON.stringify(entries()),
      previewFirst,
      previewSecond,
      deletedEntries: deletion.manager.fileEntries,
      deletedFileBytes: readFileSync(deletionPath, "utf8"),
      deletedLeaf: deletion.manager.leafId,
      statuses: deletion.statuses,
      streamingBefore,
      streamingAfter: JSON.stringify(streaming.manager.fileEntries),
      streamingInitialFileBytes: streaming.initialFileBytes,
      streamingFileBytes: readFileSync(streamingPath, "utf8"),
      streamingWarnings: streaming.warnings,
      failureBefore,
      failureAfter: JSON.stringify(failed.manager.fileEntries),
      failureInitialFileBytes: failed.initialFileBytes,
      failureFileBytes: readFileSync(failurePath, "utf8"),
      failureError,
    }));
    context.ui.setWidget("tree-delete-mode-probe", ["TREE DELETE MODE PROBE READY"]);
  });
}
