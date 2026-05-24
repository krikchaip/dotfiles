import { createRequire } from "node:module";
import { realpathSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const PATCH_FLAG = "__powerlineSpacerPatched";

function shouldAddSpacer(loader: any): boolean {
  // Walk parent chain — skip loaders nested inside BorderedLoader
  // or BashExecutionComponent (not status-container loaders).
  let parent = loader.parent;
  while (parent) {
    const name = parent.constructor?.name;
    if (name === "BorderedLoader" || name === "BashExecutionComponent")
      return false;
    parent = parent.parent;
  }
  return true;
}

function applyPatch(Loader: any) {
  if ((Loader.prototype as any)[PATCH_FLAG]) return;

  const _origUpdateDisplay = (Loader.prototype as any).updateDisplay;
  (Loader.prototype as any).updateDisplay = function () {
    if (
      typeof this.message === "string" &&
      this.message.trim() !== "" &&
      !this.message.endsWith("\n ") &&
      shouldAddSpacer(this)
    ) {
      this.message += "\n ";
    }
    return _origUpdateDisplay.call(this);
  };

  (Loader.prototype as any)[PATCH_FLAG] = true;
}

try {
  // @ts-ignore
  const req = createRequire(import.meta.url || __filename);
  const cliPath = realpathSync(process.argv[1]);
  const distPath = dirname(cliPath);
  const piRoot = dirname(distPath);
  const loaderPath = join(
    piRoot,
    "node_modules",
    "@earendil-works",
    "pi-tui",
    "dist",
    "components",
    "loader.js",
  );

  if (existsSync(loaderPath)) {
    const mod = req(loaderPath);
    applyPatch(mod.Loader);
  }
} catch {
  // Silently skip if resolution fails.
}

export default function () {
  // Patch applied at module init.
}
