import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
  rejectReopen = false,
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
    ...(rejectReopen
      ? []
      : [fauxAssistantMessage(fauxText("Waiting for version-one reopen."))]),
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
 * Fresh settings discovery must reject changed saved npm/Git sources on reopen.
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
    extensionFixtures: ["test/e2e/fixture/version-parent-ready.ts"],
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
    configureVersionIsolation(context, true, true);
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("VERSION ISOLATION COMPLETE", 45_000);
    await harness.waitUntil("the final parent turn to settle", () =>
      existsSync(join(harness.stateDirectory, "version-parent-ready")),
    );
    const loaded = harness.read(join(harness.stateDirectory, "versions.txt"));
    harness.assert(
      loaded === "parent:1.0.0\nchild:1.0.0\nchild:2.0.0\n",
      `Fresh ${kind} settings executed a changed saved child source:\n${loaded}`,
    );
    const view = await harness.capture();
    harness.assert(
      view.includes("Saved extension") && view.includes("changed"),
      "Resume did not report changed extension source integrity.",
    );
    harness.assert(
      harness.filesNamed("manifest.json").length === 2 &&
        (await harness.childPanes()).length === 0,
      "Refused resume removed a saved manifest or left a child pane.",
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

/**
 * Restores a stopped child's deleted native-temp Package at its saved exact source.
 */
export const extensionTemporaryRecoveryScenarios: readonly Scenario[] = [
  "npm",
  "git",
].map((kind) => ({
  name: `agent-extension-${kind}-temporary-recovery`,
  timeoutMs: 60_000,
  process: {
    managed: true,
    positionalPrompt: "Delegate the temporary recovery task.",
    extensionFixtures: ["test/e2e/fixture/version-parent-ready.ts"],
  },
  async prepare(harness) {
    const npmCommand = await startVersionRegistry(harness);
    const sources =
      kind === "git"
        ? await startVersionGitRepository(harness)
        : [`npm:${VERSION_PACKAGE}@1.0.0`, `npm:${VERSION_PACKAGE}@2.0.0`];
    prepareVersionDefinitions(harness, sources, npmCommand);
    writeFileSync(
      join(harness.stateDirectory, "recovery-log-path"),
      harness.logPath,
    );
  },
  configureProvider(context) {
    if (context.role === "child") {
      context.faux.setResponses([fauxSubagentDone("Version child completed.")]);
      return;
    }
    const launch = (resume?: string) =>
      fauxAssistantMessage(
        fauxToolCall("Agent", {
          description: "Temporary Package recovery",
          prompt: "Complete the temporary recovery task.",
          ...(resume ? { resume } : { subagent_type: "version-two" }),
        }),
        { stopReason: "toolUse" },
      );
    context.faux.setResponses([
      launch(),
      fauxAssistantMessage(fauxText("Waiting for the first child.")),
      (providerContext) => {
        const path = sessionPath(
          providerContext.messages,
          /Resume:\s*([^"\n]+session\.jsonl)/,
        );
        const state = process.env.PI_CODING_AGENT_DIR;
        if (!path || !state)
          throw new Error(
            "Recovery fixture has no managed session or isolated state.",
          );
        const manifest = JSON.parse(
          readFileSync(join(path, "..", "manifest.json"), "utf8"),
        ) as {
          extensionIntegrity: {
            package?: { root: string; temporary: boolean; exactSource: string };
          }[];
        };
        const pkg = manifest.extensionIntegrity.find(
          (entry) => entry.package?.temporary,
        )?.package;
        if (!pkg || !pkg.root.startsWith(`${join(state, "tmp")}/`))
          throw new Error(
            "Recovery fixture did not select a test-owned native-temp Package.",
          );
        writeFileSync(join(state, "recovered-source.txt"), pkg.exactSource);
        const logPath = readFileSync(join(state, "recovery-log-path"), "utf8");
        writeFileSync(
          join(state, "recovery-log-offset"),
          String(readFileSync(logPath, "utf8").length),
        );
        rmSync(pkg.root, { recursive: true });
        return launch(path);
      },
      fauxAssistantMessage(fauxText("Waiting for the recovered child.")),
      fauxAssistantMessage(fauxText("VERSION ISOLATION COMPLETE")),
    ]);
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("VERSION ISOLATION COMPLETE", 45_000);
    await harness.waitUntil("the final parent turn to settle", () =>
      existsSync(join(harness.stateDirectory, "version-parent-ready")),
    );
    const loaded = harness.read(join(harness.stateDirectory, "versions.txt"));
    harness.assert(
      loaded === "parent:1.0.0\nchild:2.0.0\nchild:2.0.0\n",
      `Native ${kind} recovery changed saved child bytes:\n${loaded}`,
    );
    const exact = harness.read(
      join(harness.stateDirectory, "recovered-source.txt"),
    );
    harness.assert(
      kind === "npm"
        ? exact === `npm:${VERSION_PACKAGE}@2.0.0`
        : /@[a-f0-9]{40}$/.test(exact),
      "Temporary recovery did not save an exact installed version or commit.",
    );
    const view = await harness.capture();
    harness.assert(
      !view.includes("SUBAGENT FAILED"),
      "Recovered child failed instead of completing.",
    );
    harness.assert(
      harness.filesNamed("manifest.json").length === 1 &&
        (await harness.childPanes()).length === 0,
      "Recovery changed child identity or retained a temporary pane.",
    );
    const resources = join(harness.stateDirectory, "side-quests", "resources");
    harness.assert(
      !existsSync(resources),
      "Extension recovery allocated a Package graph.",
    );
    const offset = Number(
      harness.read(join(harness.stateDirectory, "recovery-log-offset")),
    );
    harness.assert(
      !harness.read(harness.logPath).slice(offset).includes("added 1 package"),
      "Temporary Package recovery leaked native install output into the parent terminal.",
    );
  },
}));
