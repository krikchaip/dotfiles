import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function getHostDistDir() {
  return dirname(realpathSync(process.argv[1]));
}

function hostUrl(relativePath: string) {
  return pathToFileURL(resolve(getHostDistDir(), relativePath)).href;
}

export default async function (pi: ExtensionAPI) {
  const [{ TreeSelectorComponent }, { DynamicBorder }, { theme }] =
    await Promise.all([
      import(hostUrl("modes/interactive/components/tree-selector.js")),
      import(hostUrl("modes/interactive/components/dynamic-border.js")),
      import(hostUrl("modes/interactive/theme/theme.js")),
    ]);

  const treeProto = TreeSelectorComponent.prototype as any;
  if (!treeProto._borderPatched) {
    treeProto._borderPatched = true;

    const originalAddChild = treeProto.addChild;
    treeProto.addChild = function (this: any, child: any) {
      if (child instanceof DynamicBorder) {
        child.color = (s: string) => theme.fg("accent", s);
      }
      return originalAddChild.call(this, child);
    };
  }

  pi.on("session_shutdown", () => {
    if (treeProto._borderPatched) {
      delete treeProto._borderPatched;
      delete treeProto.addChild;
    }
  });
}
