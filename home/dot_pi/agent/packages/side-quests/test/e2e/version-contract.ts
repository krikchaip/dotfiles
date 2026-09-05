import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const EXPECTED_VERSION = process.env.PI_E2E_EXPECT_VERSION ?? "0.84.4";
const packageRoot = resolve(import.meta.dir, "../..");
const piExecutable = Bun.which("pi");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function packageVersion(name: string): string {
  const packageJsonPath = resolve(
    packageRoot,
    "node_modules",
    ...name.split("/"),
    "package.json",
  );
  const value = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    version?: unknown;
  };
  assert(
    typeof value.version === "string",
    `${name} package.json has no string version`,
  );
  return value.version;
}

assert(piExecutable, "Pi is not on PATH for the Side Quests E2E suite");
const result = Bun.spawnSync([piExecutable, "--version"], {
  stderr: "pipe",
  stdout: "pipe",
});
const output = `${result.stdout.toString()}${result.stderr.toString()}`;
assert(
  result.exitCode === 0,
  `Could not read Pi version from ${piExecutable}: ${output}`,
);
const executableVersion = output.match(/(?:pi_version=)?(\d+\.\d+\.\d+)/)?.[1];
assert(
  executableVersion,
  `Could not parse Pi version from ${JSON.stringify(output)}`,
);

const versions = {
  executable: executableVersion,
  "@earendil-works/pi-ai": packageVersion("@earendil-works/pi-ai"),
  "@earendil-works/pi-coding-agent": packageVersion(
    "@earendil-works/pi-coding-agent",
  ),
  "@earendil-works/pi-tui": packageVersion("@earendil-works/pi-tui"),
};
const mismatches = Object.entries(versions).filter(
  ([, version]) => version !== EXPECTED_VERSION,
);
assert(
  mismatches.length === 0,
  `Side Quests E2E version mismatch; expected ${EXPECTED_VERSION}: ${mismatches
    .map(([name, version]) => `${name}=${version}`)
    .join(", ")}`,
);

console.log(
  `PASS Side Quests E2E version contract: Pi ${EXPECTED_VERSION} executable and runtime libraries`,
);
