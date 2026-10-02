import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";

import {
  VERSION_PACKAGE,
  startVersionRegistry,
  writeVersionPackage,
} from "../fixture/version-resources.ts";
import {
  configureBasicDelegation,
  fauxSubagentDone,
} from "../provider-support.ts";
import {
  configureVersionIsolation,
  prepareVersionDefinitions,
} from "./extension-version-isolation.ts";

/** Verifies inherited and fresh package selection against an already installed package. */
export const warmPackageSnapshotScenarios: readonly Scenario[] = [
  { name: "offline-omitted", selection: undefined, offline: true },
  { name: "offline-all", selection: "true", offline: true },
  {
    name: "offline-fixed",
    selection: `[npm:${VERSION_PACKAGE}@1.0.0]`,
    offline: true,
  },
  { name: "unpinned-inherited", selection: undefined, offline: false },
].map((row) => ({
  name: `agent-resource-${row.name}`,
  process: {
    managed: true,
    offline: row.offline,
    positionalPrompt: "Delegate the warm-package task.",
  },
  async prepare(harness) {
    const npmCommand = await startVersionRegistry(harness);
    writeVersionPackage(
      join(harness.stateDirectory, "npm", "node_modules", VERSION_PACKAGE),
      "1.0.0",
      join(harness.stateDirectory, "versions.txt"),
    );
    writeFileSync(
      join(harness.stateDirectory, "settings.json"),
      JSON.stringify({
        packages: [`npm:${VERSION_PACKAGE}`],
        npmCommand,
        defaultProjectTrust: "always",
        compaction: { enabled: false },
      }),
    );
    const agents = join(harness.workDirectory, ".pi", "agents");
    mkdirSync(agents, { recursive: true });
    writeFileSync(
      join(agents, "general-purpose.md"),
      `---\ntools: [read]\n${row.selection ? `extensions: ${row.selection}\n` : ""}${row.name === "unpinned-inherited" ? "skills: []\n" : ""}---\n`,
    );
  },
  configureProvider(context) {
    configureBasicDelegation(context);
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("SUBAGENT COMPLETED");
    const loaded = harness.read(join(harness.stateDirectory, "versions.txt"));
    harness.assert(
      loaded === "parent:1.0.0\nchild:1.0.0\n",
      `Warm-package ${row.name} did not preserve the loaded parent version:\n${loaded}`,
    );
    if (row.name !== "unpinned-inherited") return;

    const manifestPath = harness.filesNamed("manifest.json")[0];
    harness.assert(manifestPath, "Inherited-package manifest is missing.");
    const manifest = JSON.parse(harness.read(manifestPath));
    const installedEntrypoint = join(
      harness.stateDirectory,
      "npm",
      "node_modules",
      VERSION_PACKAGE,
      "index.ts",
    );
    harness.assert(
      manifest.extensionPaths.includes(installedEntrypoint),
      `Inherited Package did not reuse its loaded parent path:\n${manifest.extensionPaths.join("\n")}`,
    );
    harness.assert(
      manifest.extensionPaths.every(
        (path: string) => !path.includes("/side-quests/resources/snapshot-"),
      ),
      "Inherited Package created a Package graph view before child launch.",
    );
    const snapshots = harness.filesNamed(".package-snapshot.json");
    harness.assert(
      snapshots.length === 0,
      `Unselected Package resources created graph views:\n${snapshots.join("\n")}`,
    );
  },
}));

/** Saved lazy package skills and their relative supporting files keep their version on reopen. */
export const packageSkillSnapshot: Scenario = {
  name: "agent-resource-package-skill-reopen",
  timeoutMs: 60_000,
  process: {
    managed: true,
    positionalPrompt: "Delegate the package skill task.",
  },
  async prepare(harness) {
    const npmCommand = await startVersionRegistry(harness, "skills");
    prepareVersionDefinitions(
      harness,
      [`npm:${VERSION_PACKAGE}@1.0.0`, `npm:${VERSION_PACKAGE}@2.0.0`],
      npmCommand,
      true,
    );
    for (const name of ["version-one", "version-two"]) {
      writeFileSync(
        join(harness.stateDirectory, "agents", `${name}.md`),
        "---\ndescription: Package skill snapshot\ntools: [read]\nskills: [fixture]\n---\n",
      );
    }
  },
  configureProvider(context) {
    if (context.role === "parent") {
      configureVersionIsolation(context, true);
      return;
    }
    let version = "";
    context.faux.setResponses([
      (request) => {
        const prompt = request.systemPrompt ?? "";
        version =
          prompt.match(/Package skill (\d+\.\d+\.\d+)/)?.[1] ?? "missing";
        const path = prompt.match(
          /<location>([^<]+\/fixture\/SKILL\.md)<\/location>/,
        )?.[1];
        if (!path)
          throw new Error(
            "Saved package skill path missing from provider request.",
          );
        const support = join(dirname(path), "support.txt");
        appendFileSync(
          join(process.env.PI_CODING_AGENT_DIR ?? "", "skill-versions.txt"),
          `${version}:${readFileSync(support, "utf8")}\n`,
        );
        return fauxAssistantMessage(fauxToolCall("read", { path: support }), {
          stopReason: "toolUse",
        });
      },
      () => fauxSubagentDone(`Skill ${version} completed.`),
    ]);
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("VERSION ISOLATION COMPLETE", 45_000);
    const versions = harness.read(
      join(harness.stateDirectory, "skill-versions.txt"),
    );
    harness.assert(
      versions ===
        "1.0.0:SUPPORT 1.0.0\n2.0.0:SUPPORT 2.0.0\n1.0.0:SUPPORT 1.0.0\n",
      `Saved package skills or their supporting files changed on reopen:\n${versions}`,
    );
    const manifests = harness
      .filesNamed("manifest.json")
      .map((path) => JSON.parse(harness.read(path)));
    harness.assert(
      manifests.length === 2 &&
        manifests[0].skillPaths[0] !== manifests[1].skillPaths[0],
      "Package skill children did not receive distinct immutable paths.",
    );
  },
};
