import { writeFileSync } from "node:fs";
import { InteractiveMode, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";

const proto = InteractiveMode.prototype as any;
proto.showTreeSelector = function controlledTreeSelector(this: any) {
  const treeList = {
    filteredNodes: [{ node: { entry: { id: "selected-node" } } }],
    selectedIndex: 0,
    onSelect: (_id: string) => {
      this.observed.push(this.settingsManager.getBranchSummarySkipPrompt());
    },
    handleInput(data: string) {
      if (matchesKey(data, "enter")) this.onSelect("selected-node");
    },
  };
  this.lastTreeList = treeList;
  return this.showSelector(() => ({ component: { getTreeList: () => treeList } }));
};

export default function treeConfirmSummaryProbe(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, context) => {
    const observed: boolean[] = [];
    const controlledShowSelector = (factory: () => unknown) => factory();
    const fake = {
      observed,
      settingsManager: { getBranchSummarySkipPrompt: () => true },
      showSelector: controlledShowSelector,
    } as any;

    proto.showTreeSelector.call(fake);
    fake.lastTreeList.handleInput("\r");
    fake.lastTreeList.handleInput("\x1b[13;2u");
    const restoredAfterShift = fake.settingsManager.getBranchSummarySkipPrompt();
    fake.lastTreeList.handleInput("\x1b");
    const restoredAfterEscape = fake.settingsManager.getBranchSummarySkipPrompt();

    fake.showSelector = controlledShowSelector;
    proto.showTreeSelector.call(fake);
    fake.lastTreeList.handleInput("\r");

    const path = process.env.PI_E2E_TREE_CONFIRM_CAPTURE;
    if (!path) throw new Error("PI_E2E_TREE_CONFIRM_CAPTURE is required");
    writeFileSync(
      path,
      JSON.stringify({ observed, restoredAfterShift, restoredAfterEscape }),
    );
    context.ui.setWidget("tree-confirm-summary-probe", [
      "TREE CONFIRM SUMMARY PROBE READY",
    ]);
  });
}
