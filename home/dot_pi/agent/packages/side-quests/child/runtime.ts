import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { installChildUi } from "./ui.ts";

export type ChildRuntime = Readonly<{
  role: "child";
}>;

/**
 * Owns child lifecycle and activity as they are added. This foundation starts no resource.
 */
export function installChild(pi: ExtensionAPI): void {
  const runtime: ChildRuntime = { role: "child" };
  void pi;
  installChildUi(runtime);
}
