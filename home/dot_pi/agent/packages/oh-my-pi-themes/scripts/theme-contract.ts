export type ColorValue = string | number;
export type JsonRecord = Record<string, unknown>;

export const PI_SCHEMA_URL =
  "https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json";

export const PI_REQUIRED_COLOR_TOKENS = [
  "accent",
  "border",
  "borderAccent",
  "borderMuted",
  "success",
  "error",
  "warning",
  "muted",
  "dim",
  "text",
  "thinkingText",
  "selectedBg",
  "userMessageBg",
  "userMessageText",
  "customMessageBg",
  "customMessageText",
  "customMessageLabel",
  "toolPendingBg",
  "toolSuccessBg",
  "toolErrorBg",
  "toolTitle",
  "toolOutput",
  "mdHeading",
  "mdLink",
  "mdLinkUrl",
  "mdCode",
  "mdCodeBlock",
  "mdCodeBlockBorder",
  "mdQuote",
  "mdQuoteBorder",
  "mdHr",
  "mdListBullet",
  "toolDiffAdded",
  "toolDiffRemoved",
  "toolDiffContext",
  "syntaxComment",
  "syntaxKeyword",
  "syntaxFunction",
  "syntaxVariable",
  "syntaxString",
  "syntaxNumber",
  "syntaxType",
  "syntaxOperator",
  "syntaxPunctuation",
  "thinkingOff",
  "thinkingMinimal",
  "thinkingLow",
  "thinkingMedium",
  "thinkingHigh",
  "thinkingXhigh",
  "bashMode",
] as const;

export const PI_OPTIONAL_COLOR_TOKENS = ["scrollbarThumb", "thinkingMax"] as const;

// Generated themes make Pi's two compatible fallbacks explicit.
export const GENERATED_COLOR_TOKENS = [
  ...PI_REQUIRED_COLOR_TOKENS.slice(0, 12),
  "scrollbarThumb",
  ...PI_REQUIRED_COLOR_TOKENS.slice(12, 50),
  "thinkingMax",
  ...PI_REQUIRED_COLOR_TOKENS.slice(50),
] as const;

export const OMP_ONLY_COLOR_TOKENS = [
  "link",
  "toolText",
  "pythonMode",
  "statusLineBg",
  "statusLineSep",
  "statusLineModel",
  "statusLinePath",
  "statusLineGitClean",
  "statusLineGitDirty",
  "statusLineContext",
  "statusLineSpend",
  "statusLineStaged",
  "statusLineDirty",
  "statusLineUntracked",
  "statusLineOutput",
  "statusLineCost",
  "statusLineSubagents",
] as const;

export const OMP_REQUIRED_COLOR_TOKENS = [
  ...PI_REQUIRED_COLOR_TOKENS,
  ...OMP_ONLY_COLOR_TOKENS.filter((token) => token !== "link" && token !== "toolText"),
] as const;

export const ALLOWED_THEME_ROOT_KEYS = ["$schema", "name", "vars", "colors", "export"] as const;
export const ALLOWED_UPSTREAM_ROOT_KEYS = [...ALLOWED_THEME_ROOT_KEYS, "symbols"] as const;
export const EXPORT_COLOR_TOKENS = ["pageBg", "cardBg", "infoBg"] as const;

export function assertRecord(value: unknown, label: string): asserts value is JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

export function assertExactKeys(
  actualKeys: readonly string[],
  expectedKeys: readonly string[],
  label: string,
): void {
  const actual = new Set(actualKeys);
  const expected = new Set(expectedKeys);
  const missing = [...expected].filter((key) => !actual.has(key)).sort();
  const extra = [...actual].filter((key) => !expected.has(key)).sort();
  if (missing.length || extra.length) {
    throw new Error(
      `${label} key mismatch; missing=[${missing.join(", ")}], extra=[${extra.join(", ")}]`,
    );
  }
}

export function assertSubsetKeys(
  actualKeys: readonly string[],
  allowedKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedKeys);
  const extra = actualKeys.filter((key) => !allowed.has(key)).sort();
  if (extra.length) throw new Error(`${label} has unsupported keys: ${extra.join(", ")}`);
}

function assertColorValue(
  value: unknown,
  vars: JsonRecord,
  label: string,
  trail = new Set<string>(),
): asserts value is ColorValue {
  if (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 255) return;
  if (typeof value !== "string") {
    throw new Error(`${label} must be a color string or integer from 0 to 255`);
  }
  if (value === "" || /^#[0-9a-fA-F]{6}$/.test(value)) return;
  if (!Object.hasOwn(vars, value)) {
    throw new Error(`${label} references undefined variable ${JSON.stringify(value)}`);
  }
  if (trail.has(value)) {
    throw new Error(`${label} has a cyclic variable reference through ${JSON.stringify(value)}`);
  }
  assertColorValue(vars[value], vars, `${label} -> vars.${value}`, new Set([...trail, value]));
}

export function assertColorValues(varsValue: unknown, colors: JsonRecord, label: string): void {
  const vars = varsValue ?? {};
  assertRecord(vars, `${label}.vars`);
  for (const [name, value] of Object.entries(vars)) {
    assertColorValue(value, vars, `${label}.vars.${name}`, new Set([name]));
  }
  for (const [name, value] of Object.entries(colors)) {
    assertColorValue(value, vars, `${label}.${name}`);
  }
}
