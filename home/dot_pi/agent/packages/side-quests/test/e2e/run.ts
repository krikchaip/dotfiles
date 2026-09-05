#!/usr/bin/env bun

import { mkdtempSync, realpathSync } from "node:fs";
import { availableParallelism, homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { E2EHarness, cleanupHarnessRun } from "./harness.ts";
import { scenarioByName, scenarios } from "./scenarios.ts";
import "./version-contract.ts";

async function applyRuntime(runtimeDirectory: string): Promise<void> {
  const process = Bun.spawn(["chezmoi", "apply", runtimeDirectory], {
    stderr: "inherit",
    stdout: "inherit",
  });

  const status = await process.exited;
  if (status !== 0)
    throw new Error(`chezmoi apply failed with status ${status}.`);
}

function selectedScenarios() {
  const selected = process.env.SIDE_QUESTS_E2E_MODES?.trim();
  if (!selected) return scenarios;

  const startup = scenarios.slice(0, 3);
  const startupNames = new Set(startup.map((scenario) => scenario.name));
  const managed = selected
    .split(/\s+/)
    .filter((name) => !startupNames.has(name))
    .map((name) => {
      const scenario = scenarioByName(name);
      if (!scenario) throw new Error(`Unknown E2E scenario: ${name}`);
      return scenario;
    });

  return [...startup, ...managed];
}

async function runScenario(
  scenario: Scenario,
  harness: E2EHarness,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutMs =
    scenario.timeoutMs ?? (scenario.process.managed ? 45_000 : 15_000);

  const watchdog = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      void harness.abort().finally(() => {
        reject(new Error(`Timed out after ${timeoutMs}ms: ${scenario.name}`));
      });
    }, timeoutMs);
  });

  try {
    await Promise.race([scenario.run(harness), watchdog]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function configuredConcurrency(scenarioCount: number): number {
  const defaultJobs = Math.min(4, availableParallelism());
  const raw = process.env.SIDE_QUESTS_E2E_JOBS ?? String(defaultJobs);
  const jobs = Number(raw);

  if (!Number.isInteger(jobs) || jobs < 1)
    throw new Error(`SIDE_QUESTS_E2E_JOBS must be a positive integer: ${raw}`);

  return Math.min(jobs, scenarioCount);
}

function cleanup(keepArtifacts: boolean): Promise<void> {
  cleanupPromise ??= cleanupHarnessRun(sockets, runDirectory, keepArtifacts);
  return cleanupPromise;
}

async function abortActiveHarnesses(): Promise<void> {
  await Promise.all([...activeHarnesses].map((harness) => harness.abort()));
}

function handleSignal(exitCode: number): void {
  console.error(`Interrupted. Artifacts: ${runDirectory}`);
  void abortActiveHarnesses()
    .then(() => cleanup(true))
    .finally(() => process.exit(exitCode));
}

async function executeScenario(
  scenario: Scenario,
  index: number,
): Promise<void> {
  const startedAt = performance.now();
  const harness = await E2EHarness.start({
    extension,
    root,
    runDirectory,
    scenario,
    socket: sockets[index],
  });
  activeHarnesses.add(harness);

  try {
    await runScenario(scenario, harness);
    await harness.finish();
    const seconds = ((performance.now() - startedAt) / 1_000).toFixed(1);
    console.log(`PASS ${scenario.name} (${seconds}s)`);
  } catch (error) {
    await harness.abort();
    throw error;
  } finally {
    activeHarnesses.delete(harness);
  }
}

async function runScenariosInParallel(
  selected: readonly Scenario[],
  concurrency: number,
): Promise<void> {
  let nextIndex = 0;
  let firstFailure: unknown;

  async function worker(): Promise<void> {
    while (firstFailure === undefined) {
      const index = nextIndex++;
      const scenario = selected[index];
      if (!scenario) return;

      try {
        const scenarioIndex = selectedScenarioIndexes.get(scenario);
        if (scenarioIndex === undefined)
          throw new Error(`Missing E2E scenario index: ${scenario.name}`);
        await executeScenario(scenario, scenarioIndex);
      } catch (cause) {
        firstFailure ??= new Error(`E2E ${scenario.name} failed.`, { cause });
        await abortActiveHarnesses();
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  if (firstFailure !== undefined) throw firstFailure;
}

async function runSelectedScenarios(
  selected: readonly Scenario[],
  concurrency: number,
): Promise<void> {
  const parallel = selected.filter((scenario) => !scenario.exclusive);
  const exclusive = selected.filter((scenario) => scenario.exclusive);

  if (parallel.length)
    await runScenariosInParallel(
      parallel,
      Math.min(concurrency, parallel.length),
    );

  for (const scenario of exclusive) {
    const scenarioIndex = selectedScenarioIndexes.get(scenario);
    if (scenarioIndex === undefined)
      throw new Error(`Missing E2E scenario index: ${scenario.name}`);
    await executeScenario(scenario, scenarioIndex);
  }
}

const root = realpathSync(resolve(import.meta.dir, "../.."));
const runtimeDirectory = join(homedir(), ".pi/agent/packages/side-quests");
const extension = join(runtimeDirectory, "index.ts");
const runDirectory = mkdtempSync(join(tmpdir(), "side-quests-e2e-"));
const selected = selectedScenarios();
const concurrency = configuredConcurrency(selected.length);
const sockets = selected.map((_scenario, index) =>
  join(runDirectory, `${index}.sock`),
);
const selectedScenarioIndexes = new Map(
  selected.map((scenario, index) => [scenario, index]),
);
const activeHarnesses = new Set<E2EHarness>();

let cleanupPromise: Promise<void> | undefined;
let failed = false;

process.once("SIGINT", () => handleSignal(130));
process.once("SIGTERM", () => handleSignal(143));

try {
  await applyRuntime(runtimeDirectory);
  const workerLabel = concurrency === 1 ? "worker" : "workers";
  const exclusiveCount = selected.filter(
    (scenario) => scenario.exclusive,
  ).length;
  console.log(
    `E2E ${selected.length} scenarios with ${concurrency} parallel ${workerLabel}${exclusiveCount ? ` and ${exclusiveCount} exclusive` : ""}`,
  );
  await runSelectedScenarios(selected, concurrency);
} catch (error) {
  failed = true;

  console.error("FAIL Side Quests E2E");
  console.error(error);
  console.error(`Artifacts: ${runDirectory}`);

  process.exitCode = 1;
} finally {
  await cleanup(failed);
}

if (!failed) console.log("PASS Side Quests E2E");
