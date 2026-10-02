import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";

import {
  VERSION_PACKAGE,
  startVersionRegistry,
} from "../fixture/version-resources.ts";
import { configureBasicDelegation } from "../provider-support.ts";

const source = "npm:sq-budget-launch-fixture@1.0.0";

/**
 * Prepares a warm Package without npm, network requests, or real user resources.
 */
async function prepareWarmPackage(harness: E2EHarness, payloadBytes: number) {
  const directory = join(
    harness.stateDirectory,
    "npm",
    "node_modules",
    "sq-budget-launch-fixture",
  );
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({
      name: "sq-budget-launch-fixture",
      version: "1.0.0",
      pi: { extensions: ["index.ts"], skills: ["skills"] },
    }),
  );
  writeFileSync(
    join(directory, "index.ts"),
    "export default function (pi) { pi.on('session_start', (_event, ctx) => ctx.ui.notify('BUDGET PACKAGE LOADED', 'info')); }\n",
  );
  const skill = join(directory, "skills", "sq-budget-skill");
  mkdirSync(skill, { recursive: true });
  writeFileSync(
    join(skill, "SKILL.md"),
    "---\nname: sq-budget-skill\ndescription: Budget fixture\n---\nBudget fixture instructions.\n",
  );
  writeFileSync(join(directory, "payload"), Buffer.alloc(payloadBytes));
  writeFileSync(
    join(harness.stateDirectory, "settings.json"),
    JSON.stringify({
      packages: [source],
      defaultProjectTrust: "always",
      compaction: { enabled: false },
    }),
  );
}

/**
 * Actual Agent launches fail before graph allocation and do not retain launch state.
 */
export const diskSafeLaunchRefusal: Scenario = {
  name: "agent-disk-budget-refusal",
  process: {
    fauxProvider: true,
    offline: true,
    resourceBudgetBytes: 128 * 1024,
    positionalPrompt: "Delegate the disk-budget test.",
    agentDefinitions: {
      "general-purpose":
        "---\ntools: [read]\nextensions: false\nskills: [sq-budget-skill]\n---\n",
    },
  },
  async prepare(harness) {
    await prepareWarmPackage(harness, 96 * 1024);
  },
  configureProvider(context) {
    configureBasicDelegation(context);
  },
  async run(harness: E2EHarness) {
    await harness.waitFor(/resource budget\s+exceeded/);
    harness.assert(
      (await harness.childPanes()).length === 0,
      "Budget refusal retained a child pane.",
    );
    harness.assert(
      harness.filesNamed("manifest.json").length === 0,
      "Budget refusal retained a manifest.",
    );
    harness.assert(
      harness.filesNamed("session.jsonl").length === 0,
      "Budget refusal retained a child session.",
    );
    const resources = join(harness.stateDirectory, "side-quests", "resources");
    harness.assert(
      !existsSync(resources) || readdirSync(resources).length === 0,
      "Budget refusal created a partial Package copy.",
    );
    harness.assert(
      !existsSync(
        join(harness.stateDirectory, "side-quests", "resource-allocation.lock"),
      ),
      "Budget refusal retained its allocator lock.",
    );
  },
};

/**
 * Small warm Packages still load and complete under a bounded real child launch.
 */
export const diskSafeWarmLaunch: Scenario = {
  name: "agent-disk-budget-warm-launch",
  process: {
    managed: true,
    offline: true,
    resourceBudgetBytes: 256 * 1024,
    positionalPrompt: "Delegate the small warm Package test.",
    agentDefinitions: {
      "general-purpose": `---\ntools: [read]\nextensions: [${source}]\nskills: []\n---\n`,
    },
  },
  async prepare(harness) {
    await prepareWarmPackage(harness, 1024);
  },
  configureProvider(context) {
    configureBasicDelegation(context);
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("SUBAGENT COMPLETED");
    const resources = join(harness.stateDirectory, "side-quests", "resources");
    harness.assert(
      !existsSync(resources) || readdirSync(resources).length === 0,
      "Warm Package extension allocated a Package graph.",
    );
    const manifest = JSON.parse(
      harness.read(harness.filesNamed("manifest.json")[0] ?? ""),
    );
    const entrypoint = join(
      harness.stateDirectory,
      "npm",
      "node_modules",
      "sq-budget-launch-fixture",
      "index.ts",
    );
    harness.assert(
      manifest.extensionPaths.includes(entrypoint),
      "Warm child did not reuse the installed Package entrypoint.",
    );
  },
};

/**
 * A cold Package installs from a bounded loopback registry into Pi's native temp path.
 */
export const diskSafeColdLaunch: Scenario = {
  name: "agent-disk-budget-cold-install",
  timeoutMs: 60_000,
  process: {
    managed: true,
    offline: false,
    resourceBudgetBytes: 512 * 1024,
    positionalPrompt: "Delegate the cold Package test.",
    agentDefinitions: {
      "general-purpose": `---\ntools: [read]\nextensions: [npm:${VERSION_PACKAGE}@1.0.0]\n---\n`,
    },
  },
  async prepare(harness) {
    const npmCommand = await startVersionRegistry(harness);
    writeFileSync(
      join(harness.stateDirectory, "settings.json"),
      JSON.stringify({
        npmCommand,
        defaultProjectTrust: "always",
        compaction: { enabled: false },
      }),
    );
  },
  configureProvider(context) {
    configureBasicDelegation(context);
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("SUBAGENT COMPLETED", 45_000);
    await Bun.sleep(100);
    harness.assert(
      !harness.read(harness.logPath).includes("added 1 package"),
      "Cold npm install output leaked into the parent Pi terminal stream.",
    );
    const manifest = JSON.parse(
      harness.read(harness.filesNamed("manifest.json")[0] ?? ""),
    );
    harness.assert(
      manifest.extensionPaths.some(
        (path: string) =>
          path.includes("/tmp/extensions/npm/") &&
          path.endsWith(`/${VERSION_PACKAGE}/index.ts`),
      ),
      "Cold child did not use Pi's native temporary Package entrypoint.",
    );
    harness.assert(
      harness.filesNamed(".package-snapshot.json").length === 0,
      "Cold Package extension allocated a Package graph.",
    );
    harness.assert(
      harness.read(join(harness.stateDirectory, "versions.txt")) ===
        "child:1.0.0\n",
      "Cold child did not load the installed fixture version.",
    );
  },
};
