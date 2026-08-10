import {
  ALLOWED_UPSTREAM_ROOT_KEYS,
  EXPORT_COLOR_TOKENS,
  GENERATED_COLOR_TOKENS,
  OMP_ONLY_COLOR_TOKENS,
  OMP_REQUIRED_COLOR_TOKENS,
  PI_OPTIONAL_COLOR_TOKENS,
  PI_SCHEMA_URL,
  assertColorValues,
  assertRecord,
  assertSubsetKeys,
  type ColorValue,
  type JsonRecord,
} from "./theme-contract.ts";

export interface ThemeRecord {
  name: string;
  filename: string;
  sourcePath: string;
}

export interface AdaptedTheme {
  $schema: string;
  name: string;
  vars?: Record<string, ColorValue>;
  colors: Record<string, ColorValue>;
  export?: Record<string, ColorValue>;
}

interface OmpTheme {
  name: string;
  vars?: JsonRecord;
  colors: JsonRecord;
  export?: JsonRecord;
}

export function stripAlphaByte(value: string): string {
  if (!/^#[0-9a-fA-F]{8}$/.test(value)) {
    throw new Error(`expected an 8-digit hex color, got ${JSON.stringify(value)}`);
  }
  return value.slice(0, 7);
}

function normalizeValue(
  value: unknown,
  source: OmpTheme,
  label: string,
  trail = new Set<string>(),
): ColorValue {
  if (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 255) {
    return value as number;
  }
  if (typeof value !== "string") throw new Error(`${label} has an invalid color value`);
  if (value === "" || /^#[0-9a-fA-F]{6}$/.test(value)) return value;
  if (/^#[0-9a-fA-F]{8}$/.test(value)) return stripAlphaByte(value);

  const variable = value.startsWith("$") ? value.slice(1) : value;
  if (Object.hasOwn(source.vars ?? {}, variable)) return variable;
  if (Object.hasOwn(source.colors, value)) {
    const marker = `colors.${value}`;
    if (trail.has(marker)) throw new Error(`${label} has a cyclic reference through ${marker}`);
    return normalizeValue(source.colors[value], source, label, new Set([...trail, marker]));
  }
  throw new Error(`${label} references unknown color ${JSON.stringify(value)}`);
}

function readOmpTheme(value: unknown, record: ThemeRecord): OmpTheme {
  assertRecord(value, record.filename);
  assertSubsetKeys(Object.keys(value), ALLOWED_UPSTREAM_ROOT_KEYS, record.filename);
  const { name, vars, colors, export: exportColors } = value;
  if (name !== record.name) {
    throw new Error(`${record.filename} declares unexpected name ${JSON.stringify(name)}`);
  }
  if (typeof name !== "string" || name.includes("/")) {
    throw new Error(`${record.filename} has an invalid theme name`);
  }
  if (vars !== undefined) assertRecord(vars, `${record.filename}.vars`);
  assertRecord(colors, `${record.filename}.colors`);
  if (exportColors !== undefined) assertRecord(exportColors, `${record.filename}.export`);
  return { name, vars, colors, export: exportColors };
}

export function adaptTheme(value: unknown, record: ThemeRecord): AdaptedTheme {
  const source = readOmpTheme(value, record);
  const allowedSourceTokens = [
    ...OMP_REQUIRED_COLOR_TOKENS,
    ...PI_OPTIONAL_COLOR_TOKENS.filter((token) => token !== "scrollbarThumb"),
    ...OMP_ONLY_COLOR_TOKENS,
  ];
  assertSubsetKeys(Object.keys(source.colors), allowedSourceTokens, `${record.filename}.colors`);
  const missing = OMP_REQUIRED_COLOR_TOKENS.filter(
    (token) => !Object.hasOwn(source.colors, token),
  );
  if (missing.length) {
    throw new Error(`${record.filename}.colors lacks OMP-required tokens: ${missing.join(", ")}`);
  }
  if (source.export) {
    assertSubsetKeys(Object.keys(source.export), EXPORT_COLOR_TOKENS, `${record.filename}.export`);
  }

  for (const [token, color] of Object.entries(source.colors)) {
    normalizeValue(color, source, `${record.filename}.colors.${token}`);
  }

  const vars = source.vars
    ? Object.fromEntries(
        Object.entries(source.vars).map(([name, color]) => [
          name,
          normalizeValue(color, source, `${record.filename}.vars.${name}`),
        ]),
      )
    : undefined;
  const colors = Object.fromEntries(
    GENERATED_COLOR_TOKENS.map((token) => {
      let color = source.colors[token];
      if (token === "scrollbarThumb") color = source.colors.selectedBg;
      if (token === "thinkingMax") color = source.colors.thinkingXhigh;
      return [token, normalizeValue(color, source, `${record.filename}.colors.${token}`)];
    }),
  );
  const exportColors = source.export
    ? Object.fromEntries(
        Object.entries(source.export).map(([name, color]) => [
          name,
          normalizeValue(color, source, `${record.filename}.export.${name}`),
        ]),
      )
    : undefined;

  assertColorValues(vars, colors, record.filename);
  if (exportColors) assertColorValues(vars, exportColors, `${record.filename}.export`);

  return {
    $schema: PI_SCHEMA_URL,
    name: source.name,
    ...(vars ? { vars } : {}),
    colors,
    ...(exportColors ? { export: exportColors } : {}),
  };
}
