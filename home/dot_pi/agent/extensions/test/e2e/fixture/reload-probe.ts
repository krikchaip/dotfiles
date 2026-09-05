import { readFileSync, writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function reloadProbe(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, context) => {
    if (context.mode !== "tui") return;
    const path = process.env.PI_E2E_RELOAD_COUNT;
    if (!path) throw new Error("PI_E2E_RELOAD_COUNT is required");

    let previous = 0;
    try {
      previous = Number.parseInt(readFileSync(path, "utf8"), 10) || 0;
    } catch {}
    const generation = previous + 1;
    writeFileSync(path, `${generation}\n`);
    context.ui.setWidget("reload-probe", [`RELOAD PROBE ${generation}`]);
  });
}
