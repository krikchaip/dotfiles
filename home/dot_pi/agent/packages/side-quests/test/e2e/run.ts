#!/usr/bin/env bun

import { mkdtempSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { E2EHarness, cleanupHarnessRun } from "./harness.ts";
import { scenarioByName, scenarios } from "./scenario/index.ts";
import type { Scenario } from "./scenario/types.ts";

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

function cleanup(keepArtifacts: boolean): Promise<void> {
  cleanupPromise ??= cleanupHarnessRun(socket, runDirectory, keepArtifacts);
  return cleanupPromise;
}

function handleSignal(exitCode: number): void {
  console.error(`Interrupted. Artifacts: ${runDirectory}`);
  void cleanup(true).finally(() => process.exit(exitCode));
}

const root = realpathSync(resolve(import.meta.dir, "../.."));
const runtimeDirectory = join(homedir(), ".pi/agent/packages/side-quests");
const extension = join(runtimeDirectory, "index.ts");
const runDirectory = mkdtempSync(join(tmpdir(), "side-quests-e2e-"));
const socket = join(runDirectory, "tmux.sock");

let cleanupPromise: Promise<void> | undefined;
let failed = false;

process.once("SIGINT", () => handleSignal(130));
process.once("SIGTERM", () => handleSignal(143));

try {
  await applyRuntime(runtimeDirectory);

  for (const scenario of selectedScenarios()) {
    process.stdout.write(`E2E ${scenario.name} ... `);

    const harness = await E2EHarness.start({
      extension,
      root,
      runDirectory,
      scenario,
      socket,
    });

    try {
      await runScenario(scenario, harness);
      await harness.finish();

      process.stdout.write("PASS\n");
    } catch (error) {
      await harness.abort();
      throw error;
    }
  }
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
