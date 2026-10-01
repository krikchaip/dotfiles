import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import {
  VERSION_PACKAGE,
  startVersionGitRepository,
  startVersionRegistry,
} from "../fixture/version-resources.ts";
import {
  configureBasicDelegation,
  fauxSubagentDone,
  sessionPath,
} from "../provider-support.ts";

/**
 * Drives v1, a signed v2 upsert, and v1 reopen through public Agent calls.
 */
export function configureVersionIsolation(
  context: ProviderContext,
  fresh = false,
): void {
  if (context.role === "child") {
    context.faux.setResponses([fauxSubagentDone("Version child completed.")]);
    return;
  }
  const launch = (type: string, resume?: string) =>
    fauxAssistantMessage(
      fauxToolCall("Agent", {
        description: "Version isolation",
        prompt: "Complete the version-isolation task.",
        ...(resume ? { resume } : { subagent_type: type }),
      }),
      { stopReason: "toolUse" },
    );
  context.faux.setResponses([
    launch("version-one"),
    fauxAssistantMessage(fauxText("Waiting for version one.")),
    () => {
      if (fresh) {
        const state = process.env.PI_CODING_AGENT_DIR;
        if (!state)
          throw new Error("Fresh-version test has no isolated state.");
        const path = join(state, "settings.json");
        const settings = JSON.parse(readFileSync(path, "utf8"));
        settings.packages = [
          readFileSync(join(state, "next-source.txt"), "utf8"),
        ];
        writeFileSync(path, JSON.stringify(settings));
      }
      return launch("version-two");
    },
    fauxAssistantMessage(fauxText("Waiting for version two.")),
    (providerContext) => {
      const path = sessionPath(
        providerContext.messages,
        /Resume:\s*([^"\n]+session\.jsonl)/,
      );
      return path
        ? launch("", path)
        : fauxAssistantMessage("Missing version-one resume path.", {
            stopReason: "error",
            errorMessage: "Missing version-one resume path.",
          });
    },
    fauxAssistantMessage(fauxText("Waiting for version-one reopen.")),
    fauxAssistantMessage(fauxText("VERSION ISOLATION COMPLETE")),
  ]);
}

/**
 * Installs test-owned definitions before native resource discovery begins.
 */
export function prepareVersionDefinitions(
  harness: E2EHarness,
  sources: readonly string[],
  npmCommand: string[],
  fresh = false,
): void {
  const agents = join(harness.stateDirectory, "agents");
  mkdirSync(agents, { recursive: true });
  for (const [index, name] of ["version-one", "version-two"].entries()) {
    const source = `${index ? "+" : ""}${sources[index]}`;
    writeFileSync(
      join(agents, `${name}.md`),
      `---\ndescription: Version fixture\ntools: [read]\nextensions: ${fresh ? "true" : `[${JSON.stringify(source)}]`}\n---\n`,
    );
  }
  writeFileSync(
    join(harness.stateDirectory, "next-source.txt"),
    sources[1] ?? "",
  );
  writeFileSync(
    join(harness.stateDirectory, "settings.json"),
    JSON.stringify({
      packages: [sources[0]],
      npmCommand,
      defaultProjectTrust: "always",
      compaction: { enabled: false },
    }),
  );
}

/**
 * Fresh settings discovery must preserve older npm/Git children across reopen.
 */
export const extensionFreshVersionIsolationScenarios: readonly Scenario[] = [
  "npm",
  "git",
].map((kind) => ({
  name: `agent-extension-${kind}-fresh-version-isolation`,
  timeoutMs: 60_000,
  process: {
    managed: true,
    positionalPrompt: "Delegate the fresh-version task.",
  },
  async prepare(harness) {
    const npmCommand = await startVersionRegistry(harness);
    const sources =
      kind === "git"
        ? await startVersionGitRepository(harness)
        : [`npm:${VERSION_PACKAGE}@1.0.0`, `npm:${VERSION_PACKAGE}@2.0.0`];
    prepareVersionDefinitions(harness, sources, npmCommand, true);
  },
  configureProvider(context) {
    configureVersionIsolation(context, true);
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("VERSION ISOLATION COMPLETE", 45_000);
    const loaded = harness.read(join(harness.stateDirectory, "versions.txt"));
    harness.assert(
      loaded === "parent:1.0.0\nchild:1.0.0\nchild:2.0.0\nchild:1.0.0\n",
      `Fresh ${kind} settings changed an older child snapshot:\n${loaded}`,
    );
  },
}));

/**
 * Native npm/Git identities reject different versions/refs in one expression.
 */
export const extensionRemoteIdentityScenarios: readonly Scenario[] = [
  "npm",
  "git",
].flatMap((kind) =>
  ["duplicate", "conflict"].map((operation) => ({
    name: `agent-extension-${kind}-identity-${operation}`,
    timeoutMs: 60_000,
    process: {
      fauxProvider: true,
      offline: false,
      positionalPrompt: "Attempt the invalid version expression.",
    },
    async prepare(harness) {
      const npmCommand = await startVersionRegistry(harness);
      const sources =
        kind === "git"
          ? await startVersionGitRepository(harness)
          : [`npm:${VERSION_PACKAGE}@1.0.0`, `npm:${VERSION_PACKAGE}@2.0.0`];
      prepareVersionDefinitions(harness, sources, npmCommand);
      const selection = sources.map(
        (source, index) =>
          (operation === "conflict" ? (index ? "-" : "+") : "") + source,
      );
      writeFileSync(
        join(harness.stateDirectory, "agents", "version-one.md"),
        `---\ndescription: Invalid version expression\ntools: [read]\nextensions: ${JSON.stringify(selection)}\n---\n`,
      );
    },
    configureProvider(context) {
      configureBasicDelegation(context, { subagentType: "version-one" });
    },
    async run(harness: E2EHarness) {
      await harness.waitFor("The delegated work is in progress.", 45_000);
      const view = await harness.capture();
      harness.assert(
        view.includes(
          operation === "duplicate"
            ? "repeats Pi identity"
            : "conflicts on Pi identity",
        ),
        "Invalid remote version/ref expression was not rejected by Pi identity.",
      );
      harness.assert(
        harness.filesNamed("manifest.json").length === 0 &&
          (await harness.childPanes()).length === 0,
        "Invalid remote expression retained child launch state.",
      );
      harness.assert(
        harness.read(join(harness.stateDirectory, "versions.txt")) ===
          "parent:1.0.0\n",
        "A rejected remote expression executed a child package factory.",
      );
    },
  })),
);

/**
 * Git ref replacement must load the requested ref without changing saved children.
 */
export const extensionGitVersionIsolation: Scenario = {
  name: "agent-extension-git-ref-isolation",
  timeoutMs: 60_000,
  process: {
    managed: true,
    positionalPrompt: "Delegate the version-isolation task.",
  },
  async prepare(harness) {
    const npmCommand = await startVersionRegistry(harness);
    const sources = await startVersionGitRepository(harness);
    prepareVersionDefinitions(harness, sources, npmCommand);
  },
  configureProvider: configureVersionIsolation,
  async run(harness: E2EHarness) {
    await harness.waitFor("VERSION ISOLATION COMPLETE", 45_000);
    const loaded = harness.read(join(harness.stateDirectory, "versions.txt"));
    harness.assert(
      loaded === "parent:1.0.0\nchild:1.0.0\nchild:2.0.0\nchild:1.0.0\n",
      `Git refs were not isolated across signed upsert and reopen:\n${loaded}`,
    );
  },
};

/**
 * npm version replacement must not change an earlier child's saved source.
 */
export const extensionNpmVersionIsolation: Scenario = {
  name: "agent-extension-npm-version-isolation",
  timeoutMs: 60_000,
  process: {
    managed: true,
    positionalPrompt: "Delegate the version-isolation task.",
  },
  async prepare(harness) {
    const npmCommand = await startVersionRegistry(harness);
    prepareVersionDefinitions(
      harness,
      [`npm:${VERSION_PACKAGE}@1.0.0`, `npm:${VERSION_PACKAGE}@2.0.0`],
      npmCommand,
    );
  },
  configureProvider: configureVersionIsolation,
  async run(harness: E2EHarness) {
    await harness.waitFor("VERSION ISOLATION COMPLETE", 45_000);
    const loaded = harness.read(join(harness.stateDirectory, "versions.txt"));
    harness.assert(
      loaded === "parent:1.0.0\nchild:1.0.0\nchild:2.0.0\nchild:1.0.0\n",
      `npm versions were not isolated across signed upsert and reopen:\n${loaded}`,
    );
    harness.assert(
      harness.filesNamed("manifest.json").length === 2,
      "Version test did not retain two independently resumable children.",
    );
  },
};
