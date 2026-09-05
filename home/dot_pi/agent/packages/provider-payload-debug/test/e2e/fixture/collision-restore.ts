import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { restoreDate } from "./collision-prepare.ts";

export default function installCollisionRestore(pi: ExtensionAPI): void {
  pi.on("before_provider_request", () => {
    restoreDate();
  });
}
