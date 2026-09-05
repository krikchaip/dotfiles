import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "../..");
const regressions = [
  {
    name: "transactional-sync",
    command: [process.execPath, "test/e2e/sync.ts"],
    environment: { PI_E2E_KNOWN_REGRESSION: "transactional-sync" },
    marker:
      "[KNOWN RED] post-theme README install failure leaves a mixed package snapshot",
  },
  {
    name: "native-version-allowlist",
    command: [process.execPath, "scripts/check-native.ts"],
    environment: {},
    marker: "has not been validated by this snapshot; supported versions:",
  },
] as const;

const invalid: string[] = [];
for (const regression of regressions) {
  const child = Bun.spawn([...regression.command], {
    cwd: packageRoot,
    env: { ...process.env, ...regression.environment },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const output = `${stdout}${stderr}`;

  if (status !== 0 && output.includes(regression.marker)) {
    console.error(`KNOWN-RED ${regression.name}: ${regression.marker}`);
    continue;
  }

  const reason =
    status === 0
      ? "unexpectedly passed"
      : `missed marker ${JSON.stringify(regression.marker)}`;
  invalid.push(`${regression.name} ${reason}`);
  console.error(`INVALID ${regression.name}: ${reason}`);
  process.stderr.write(output);
}

if (invalid.length > 0) {
  throw new Error(`Invalid theme known-red results: ${invalid.join(", ")}`);
}

console.error(
  `KNOWN-RED oh-my-pi-themes: ${regressions.length} baseline defects reproduced`,
);
process.exitCode = 1;
