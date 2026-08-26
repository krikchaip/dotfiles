import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { WrapUpRenderer } from "../renderer/wrap-up-renderer.ts";
import { currentEnvironment, detectRole } from "../role.ts";
import { ChildCommands } from "./command.ts";
import { ChildRuntime } from "./runtime.ts";
import { ChildTools } from "./tool.ts";
import { ChildUI } from "./ui.ts";

/**
 * Package-internal entrypoint. Managed child Pi processes load this path explicitly.
 */
export default function (pi: ExtensionAPI): void {
  const environment = currentEnvironment();
  if (detectRole(environment) !== "child") return;

  // The companion may be probed independently during extension startup. Only a
  // parent-created process receives a complete managed child identity.
  if (
    !environment.PI_SIDE_QUESTS_PARENT_ID ||
    !environment.PI_SIDE_QUESTS_SESSION
  )
    return;

  const runtime = ChildRuntime.register(pi);

  WrapUpRenderer.register(pi, runtime);
  ChildTools.register(pi, runtime);
  ChildCommands.register(pi, runtime);
  ChildUI.register(pi, runtime);
}
