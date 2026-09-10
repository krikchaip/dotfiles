/**
 * Removes configured tools from Pi's active model tool set.
 *
 * Configure in ~/.pi/agent/settings.json:
 * {
 *   "excludeTools": ["mcp__github", "mcp__atlassian"]
 * }
 */

import {
  getAgentDir,
  SettingsManager,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

type ToolExclusionSettings = {
  excludeTools?: unknown;
};

function excludedToolNames(context: ExtensionContext): Set<string> {
  const settings = SettingsManager.create(
    context.cwd,
    getAgentDir(),
  ).getGlobalSettings() as ToolExclusionSettings;
  const configured = settings.excludeTools;
  if (!Array.isArray(configured)) return new Set();

  return new Set(
    configured.filter((name): name is string => typeof name === "string"),
  );
}

function applyToolExclusions(
  pi: ExtensionAPI,
  context: ExtensionContext,
): void {
  const excluded = excludedToolNames(context);
  if (excluded.size === 0) return;

  const active = pi.getActiveTools();
  const filtered = active.filter((name) => !excluded.has(name));
  if (filtered.length !== active.length) pi.setActiveTools(filtered);
}

export default function toolExclusion(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, context) => applyToolExclusions(pi, context));
  pi.on("before_agent_start", (_event, context) =>
    applyToolExclusions(pi, context),
  );
}
