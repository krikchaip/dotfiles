import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { currentEnvironment, detectRole } from "../role.ts";
import { installChild } from "./runtime.ts";

/**
 * Package-internal entrypoint. Managed child Pi processes load this path explicitly.
 */
export default function (pi: ExtensionAPI): void {
  if (detectRole(currentEnvironment()) !== "child") return;
  installChild(pi);
}
