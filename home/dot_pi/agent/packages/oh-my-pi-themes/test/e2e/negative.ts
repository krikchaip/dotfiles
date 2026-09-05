import { cpSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const EXPECTED_VERSION = process.env.PI_E2E_EXPECT_VERSION ?? "0.84.4";
const packageRoot = resolve(import.meta.dir, "../..");
const runDirectory = `/tmp/oh-my-pi-themes-negative-e2e-${process.pid}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function command(args: string[], cwd: string): Promise<{ status: number; output: string }> {
  const child = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { status, output: `${stdout}${stderr}` };
}

async function structuralFailure(
  name: string,
  mutate: (path: string) => void,
  expected: RegExp,
): Promise<void> {
  const path = join(runDirectory, name);
  cpSync(packageRoot, path, { recursive: true });
  mutate(path);
  const result = await command(["bun", "scripts/check.ts"], path);
  assert(result.status !== 0, `${name} malformed snapshot passed structural CLI`);
  assert(expected.test(result.output), `${name} returned the wrong diagnostic:\n${result.output}`);
  console.log(`PASS theme structural CLI rejects ${name}`);
}

try {
  mkdirSync(runDirectory, { recursive: true });
  await structuralFailure(
    "invalid-json",
    (path) => writeFileSync(join(path, "themes/dark.json"), "{\n"),
    /JSON|parse|Expected/i,
  );
  await structuralFailure(
    "missing-color",
    (path) => {
      const file = join(path, "themes/dark.json");
      const theme = JSON.parse(readFileSync(file, "utf8"));
      delete theme.colors.accent;
      writeFileSync(file, `${JSON.stringify(theme, null, 2)}\n`);
    },
    /missing=\[accent\]|key mismatch/i,
  );
  await structuralFailure(
    "unknown-root-key",
    (path) => {
      const file = join(path, "themes/dark.json");
      const theme = JSON.parse(readFileSync(file, "utf8"));
      theme.unknown = true;
      writeFileSync(file, `${JSON.stringify(theme, null, 2)}\n`);
    },
    /unsupported keys: unknown|extra=\[unknown\]|key mismatch/i,
  );
  await structuralFailure(
    "manifest-inventory-mismatch",
    (path) => {
      const file = join(path, "upstream.json");
      const manifest = JSON.parse(readFileSync(file, "utf8"));
      manifest.themes = manifest.themes.slice(1);
      writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
    },
    /inventory|missing|manifest/i,
  );

  const pi = Bun.which("pi");
  assert(pi, "Pi is not on PATH");
  const resolvedPi = realpathSync(pi);
  const version = Bun.spawnSync([resolvedPi, "--version"]).stdout.toString().trim();
  assert(version === EXPECTED_VERSION, `Expected Pi ${EXPECTED_VERSION}, got ${version}`);
  const loaderPath = join(
    dirname(resolvedPi),
    "..",
    "@earendil-works",
    "pi-coding-agent",
    "dist/modes/interactive/theme/theme.js",
  );
  const loader = await import(pathToFileURL(loaderPath).href);
  for (const [name, contents] of [
    ["runtime-invalid-json", "{"],
    ["runtime-missing-colors", JSON.stringify({ $schema: "x", name: "broken", colors: {} })],
    ["runtime-invalid-color", JSON.stringify({ $schema: "x", name: "broken", colors: { text: "#xyzxyz" } })],
  ] as const) {
    const file = join(runDirectory, `${name}.json`);
    writeFileSync(file, contents);
    let rejected = false;
    try {
      loader.loadThemeFromPath(file, "truecolor");
    } catch {
      rejected = true;
    }
    assert(rejected, `Native Pi theme loader accepted ${name}`);
  }
  console.log("PASS native Pi loader rejects malformed runtime themes");
} finally {
  if (process.env.KEEP_E2E_ARTIFACTS !== "1") rmSync(runDirectory, { recursive: true, force: true });
}
