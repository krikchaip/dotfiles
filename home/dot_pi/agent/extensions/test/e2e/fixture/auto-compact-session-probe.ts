import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function autoCompactSessionProbe(pi: ExtensionAPI): void {
  const path = process.env.PI_E2E_AUTO_COMPACT_SESSION_CAPTURE;
  if (!path) throw new Error("PI_E2E_AUTO_COMPACT_SESSION_CAPTURE is required");
  pi.on("session_start", (_event, context) => {
    const previous = existsSync(path)
      ? (JSON.parse(readFileSync(path, "utf8")) as { starts: number; shutdowns: number })
      : { starts: 0, shutdowns: 0 };
    const next = { ...previous, starts: previous.starts + 1 };
    writeFileSync(path, JSON.stringify(next));
    context.ui.setWidget("auto-compact-session-probe", [`AUTO COMPACT SESSION ${next.starts}`]);
  });
  pi.on("session_shutdown", () => {
    const previous = JSON.parse(readFileSync(path, "utf8")) as {
      starts: number;
      shutdowns: number;
    };
    writeFileSync(path, JSON.stringify({ ...previous, shutdowns: previous.shutdowns + 1 }));
  });
}
