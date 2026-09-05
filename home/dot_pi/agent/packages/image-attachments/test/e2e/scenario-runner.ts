export interface Scenario {
  name: string;
  command: string[];
  knownRedMarker?: string;
}

interface RunnerOptions {
  cwd: string;
  mode: "green" | "known-red";
  suiteName: string;
}

function runnerArguments(): { match?: string; workers: number } {
  const args = process.argv.slice(2);
  let match: string | undefined;
  let workers = Number(process.env.PI_E2E_WORKERS ?? 3);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--match") match = args[++index];
    else if (arg.startsWith("--match=")) match = arg.slice("--match=".length);
    else if (arg === "--workers") workers = Number(args[++index]);
    else if (arg.startsWith("--workers=")) workers = Number(arg.slice("--workers=".length));
    else throw new Error(`Unknown runner argument: ${arg}`);
  }

  if (!Number.isInteger(workers) || workers < 1 || workers > 8) {
    throw new Error(`--workers must be an integer from 1 through 8, got ${workers}.`);
  }
  return { match, workers };
}

async function execute(scenario: Scenario, cwd: string) {
  const startedAt = performance.now();
  const child = Bun.spawn(scenario.command, {
    cwd,
    env: process.env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return {
    scenario,
    status,
    stdout,
    stderr,
    durationMs: Math.round(performance.now() - startedAt),
  };
}

export async function runScenarios(
  scenarios: Scenario[],
  options: RunnerOptions,
): Promise<void> {
  const { match, workers } = runnerArguments();
  const selected = match
    ? scenarios.filter((scenario) =>
        `${scenario.name} ${scenario.command.join(" ")}`.toLowerCase().includes(match.toLowerCase()),
      )
    : scenarios;
  if (selected.length === 0) throw new Error(`No scenario matched ${JSON.stringify(match)}.`);

  const startedAt = performance.now();
  const workerCount = Math.min(workers, selected.length);
  const results: Awaited<ReturnType<typeof execute>>[] = [];
  let nextIndex = 0;
  const runWorker = async () => {
    while (nextIndex < selected.length) {
      const scenario = selected[nextIndex++]!;
      results.push(await execute(scenario, options.cwd));
    }
  };
  await Promise.all(Array.from({ length: workerCount }, runWorker));
  results.sort(
    (left, right) => selected.indexOf(left.scenario) - selected.indexOf(right.scenario),
  );

  const failures: string[] = [];
  for (const result of results) {
    const output = `${result.stdout}${result.stderr}`;
    const seconds = (result.durationMs / 1_000).toFixed(2);
    if (options.mode === "green") {
      const label = result.status === 0 ? "PASS" : "RED";
      console.log(`${label} ${result.scenario.name} (${seconds}s)`);
      if (result.status !== 0) {
        failures.push(`${result.scenario.name} exited ${result.status}`);
        process.stderr.write(output);
      }
      continue;
    }

    const marker = result.scenario.knownRedMarker;
    if (result.status !== 0 && marker && output.includes(marker)) {
      console.log(`KNOWN-RED ${result.scenario.name} (${seconds}s): ${marker}`);
    } else {
      const reason = result.status === 0
        ? "unexpectedly passed"
        : `missed marker ${JSON.stringify(marker)}`;
      failures.push(`${result.scenario.name} ${reason}`);
      console.error(`INVALID ${result.scenario.name} (${seconds}s): ${reason}`);
      process.stderr.write(output);
    }
  }

  const totalSeconds = ((performance.now() - startedAt) / 1_000).toFixed(2);
  if (failures.length > 0) {
    throw new Error(`${options.suiteName} invalid results: ${failures.join(", ")}`);
  }
  if (options.mode === "known-red") {
    console.error(
      `KNOWN-RED ${options.suiteName}: ${results.length} baseline defects reproduced (${totalSeconds}s)`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `PASS ${options.suiteName}: ${results.length} scenarios, ${workerCount} workers (${totalSeconds}s)`,
  );
}
