import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEPENDENCY_EXTENSION,
  startDependencyRegistry,
} from "../fixture/dependency-resources.ts";
import { configureBasicDelegation } from "../provider-support.ts";
import {
  configureVersionIsolation,
  prepareVersionDefinitions,
} from "./extension-version-isolation.ts";

/**
 * Inherited and explicitly selected npm extensions execute real hoisted dependencies.
 */
export const extensionDependencyScenarios: readonly Scenario[] = [
  "inherited",
  "explicit",
].map((mode) => ({
  name: `agent-extension-dependency-${mode}`,
  process: {
    managed: true,
    offline: false,
    positionalPrompt: "Delegate the dependency task.",
  },
  async prepare(harness) {
    const npmCommand = await startDependencyRegistry(harness);
    writeFileSync(
      join(harness.stateDirectory, "settings.json"),
      JSON.stringify({
        packages: [`npm:${DEPENDENCY_EXTENSION}@1.0.0`],
        npmCommand,
        defaultProjectTrust: "always",
        compaction: { enabled: false },
      }),
    );
    const agents = join(harness.workDirectory, ".pi", "agents");
    mkdirSync(agents, { recursive: true });
    writeFileSync(
      join(agents, "general-purpose.md"),
      `---\ntools: [read]\n${mode === "explicit" ? `extensions: [npm:${DEPENDENCY_EXTENSION}@1.0.0]\n` : ""}---\n`,
    );
  },
  configureProvider: configureBasicDelegation,
  async run(harness: E2EHarness) {
    const view = await harness.waitFor("The delegated work is in progress.");
    harness.assert(
      !view.includes("Cannot find module"),
      `The ${mode} extension could not import its hoisted dependency.\n${view}`,
    );
    await harness.waitFor("SUBAGENT COMPLETED");
    harness.assert(
      harness.read(join(harness.stateDirectory, "dependency-versions.txt")) ===
        "parent:1.0.0\nchild:1.0.0\n",
      `The ${mode} extension did not execute its installed dependency.`,
    );
  },
}));

/**
 * A new dependency generation cannot change an inherited child's dependency on reopen.
 */
export const inheritedDependencyReopen: Scenario = {
  name: "agent-extension-dependency-inherited-reopen",
  timeoutMs: 60_000,
  process: {
    managed: true,
    offline: false,
    positionalPrompt: "Delegate the dependency-generation task.",
  },
  async prepare(harness) {
    const npmCommand = await startDependencyRegistry(harness);
    prepareVersionDefinitions(
      harness,
      [
        `npm:${DEPENDENCY_EXTENSION}@1.0.0`,
        `npm:${DEPENDENCY_EXTENSION}@2.0.0`,
      ],
      npmCommand,
    );
    // Generation A must inherit the parent's copied graph, not freshly install it.
    writeFileSync(
      join(harness.stateDirectory, "agents", "version-one.md"),
      "---\ndescription: Inherited dependency generation\ntools: [read]\n---\n",
    );
  },
  configureProvider: configureVersionIsolation,
  async run(harness: E2EHarness) {
    await harness.waitUntil(
      "dependency generations or a specific import rejection",
      async () => {
        const view = await harness.capture();
        return (
          view.includes("VERSION ISOLATION COMPLETE") ||
          view.includes("Cannot find module")
        );
      },
      45_000,
    );
    harness.assert(
      !(await harness.capture()).includes("Cannot find module"),
      `Inherited dependency generation failed to load.\n${await harness.capture()}`,
    );
    harness.assert(
      harness.read(join(harness.stateDirectory, "dependency-versions.txt")) ===
        "parent:1.0.0\nchild:1.0.0\nchild:2.0.0\nchild:1.0.0\n",
      "Inherited dependency version changed across upsert and reopen.",
    );
    harness.assert(
      harness.filesNamed("manifest.json").length === 2,
      "Dependency generations did not retain two resumable children.",
    );
  },
};
