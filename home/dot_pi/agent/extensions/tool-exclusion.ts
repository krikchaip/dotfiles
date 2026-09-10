/**
 * Removes configured tools from Pi's active model tool set.
 *
 * Configure in ~/.pi/agent/settings.json:
 * {
 *   "excludeTools": ["mcp__*", "powershell"]
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

const REGULAR_EXPRESSION_SPECIAL_CHARACTERS = new Set([
  "\\",
  "^",
  "$",
  ".",
  "*",
  "+",
  "?",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "|",
]);

function compileToolExclusionPattern(pattern: string): RegExp {
  let expression = "^";

  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === "\\" && pattern[index + 1] === "*") {
      expression += "\\*";
      index++;
      continue;
    }
    if (character === "*") {
      expression += "[\\s\\S]*";
      continue;
    }

    expression += REGULAR_EXPRESSION_SPECIAL_CHARACTERS.has(character)
      ? `\\${character}`
      : character;
  }

  return new RegExp(`${expression}$`);
}

function configuredToolExclusions(context: ExtensionContext): RegExp[] {
  const settings = SettingsManager.create(
    context.cwd,
    getAgentDir(),
  ).getGlobalSettings() as ToolExclusionSettings;
  const configured = settings.excludeTools;
  if (!Array.isArray(configured)) return [];

  return [
    ...new Set(
      configured.filter((name): name is string => typeof name === "string"),
    ),
  ].map(compileToolExclusionPattern);
}

function applyToolExclusions(
  pi: ExtensionAPI,
  exclusions: readonly RegExp[],
): void {
  if (exclusions.length === 0) return;

  const active = pi.getActiveTools();
  const filtered = active.filter(
    (name) => !exclusions.some((pattern) => pattern.test(name)),
  );
  if (filtered.length !== active.length) pi.setActiveTools(filtered);
}

export default function toolExclusion(pi: ExtensionAPI): void {
  let exclusions: RegExp[] = [];

  pi.on("session_start", (_event, context) => {
    exclusions = configuredToolExclusions(context);
    applyToolExclusions(pi, exclusions);
  });
  pi.on("before_agent_start", () => applyToolExclusions(pi, exclusions));
  pi.on("context", () => applyToolExclusions(pi, exclusions));
}
