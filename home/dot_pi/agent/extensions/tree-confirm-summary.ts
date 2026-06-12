/**
 * Force branch summary confirmation for /tree shift+enter.
 *
 * Enter keeps branchSummary.skipPrompt behavior. Shift+Enter opens the
 * confirmation prompt for the selected tree node without changing settings.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";

import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const TREE_CONFIRM_SUMMARY_PATCHED = "__treeConfirmSummaryPatched";

interface PatchedInteractiveMode {
  showTreeSelector(initialSelectedId?: string): void;
  showSelector(factory: (done: () => void) => any): any;
  settingsManager?: { getBranchSummarySkipPrompt?: () => boolean };

  [key: string]: any;
}

function selectedEntryId(treeList: any) {
  return treeList.filteredNodes?.[treeList.selectedIndex]?.node?.entry?.id;
}

function withSummaryPromptForced(
  interactiveMode: PatchedInteractiveMode,
  callback: () => void,
) {
  const settingsManager = interactiveMode.settingsManager;
  const originalGetSkipPrompt = settingsManager?.getBranchSummarySkipPrompt;

  if (!settingsManager || typeof originalGetSkipPrompt !== "function") {
    callback();
    return;
  }

  settingsManager.getBranchSummarySkipPrompt = () => false;

  try {
    callback();
  } finally {
    settingsManager.getBranchSummarySkipPrompt = originalGetSkipPrompt;
  }
}

function patchTreeList(treeList: any, interactiveMode: PatchedInteractiveMode) {
  if (!treeList || treeList[TREE_CONFIRM_SUMMARY_PATCHED]) return;
  treeList[TREE_CONFIRM_SUMMARY_PATCHED] = true;

  const originalHandleInput = treeList.handleInput.bind(treeList);

  treeList.handleInput = function (keyData: string) {
    if (matchesKey(keyData, "shift+enter")) {
      const entryId = selectedEntryId(treeList);
      if (entryId && treeList.onSelect) {
        withSummaryPromptForced(interactiveMode, () => {
          treeList.onSelect(entryId);
        });
      }
      return;
    }

    originalHandleInput(keyData);
  };
}

function patchTreeSelector(
  selector: any,
  interactiveMode: PatchedInteractiveMode,
) {
  const treeList = selector?.getTreeList?.();
  patchTreeList(treeList, interactiveMode);
}

export default function (_pi: ExtensionAPI) {
  const req = createRequire(__filename);
  const cliPath = realpathSync(process.argv[1]);
  const distPath = dirname(cliPath);

  const { InteractiveMode } = req(
    join(distPath, "modes", "interactive", "interactive-mode.js"),
  );

  const proto = InteractiveMode.prototype as PatchedInteractiveMode;
  if (proto[TREE_CONFIRM_SUMMARY_PATCHED]) return;

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
        patchTreeSelector(result?.component, this);
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

  proto[TREE_CONFIRM_SUMMARY_PATCHED] = true;
}
