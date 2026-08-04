import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type ParentRuntime = Readonly<{
  role: "parent";
}>;

/**
 * Owns parent coordination as it is added. This foundation starts no resource.
 */
export function createParentRuntime(_pi: ExtensionAPI): ParentRuntime {
  return { role: "parent" };
}
