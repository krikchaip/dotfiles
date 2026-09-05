import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

let starts = 0;

export default function installLifecycleProbe(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    starts += 1;
    ctx.ui.notify(`PROVIDER_PAYLOAD_DEBUG_SESSION_START_${starts}`, "info");
  });
}
