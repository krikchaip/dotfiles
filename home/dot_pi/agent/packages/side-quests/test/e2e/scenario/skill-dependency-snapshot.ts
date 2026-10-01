import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";

import {
  DEPENDENCY_EXTENSION,
  startDependencyRegistry,
} from "../fixture/dependency-resources.ts";
import { fauxSubagentDone } from "../provider-support.ts";
import {
  configureVersionIsolation,
  prepareVersionDefinitions,
} from "./extension-version-isolation.ts";

/**
 * Real child bash calls execute saved package skill scripts with their own dependency version.
 */
export const skillDependencyReopen: Scenario = {
  name: "agent-skill-dependency-reopen",
  timeoutMs: 60_000,
  process: {
    managed: true,
    offline: false,
    positionalPrompt: "Delegate the package skill script task.",
  },
  async prepare(harness) {
    const npmCommand = await startDependencyRegistry(harness, "skills");
    prepareVersionDefinitions(
      harness,
      [
        `npm:${DEPENDENCY_EXTENSION}@1.0.0`,
        `npm:${DEPENDENCY_EXTENSION}@2.0.0`,
      ],
      npmCommand,
      true,
    );
    for (const name of ["version-one", "version-two"])
      writeFileSync(
        join(harness.stateDirectory, "agents", `${name}.md`),
        "---\ndescription: Dependency skill script\ntools: [read, bash]\nskills: [dependency-skill]\nextensions: true\n---\n",
      );
  },
  configureProvider(context) {
    if (context.role === "parent") {
      configureVersionIsolation(context, true);
      return;
    }
    context.faux.setResponses([
      (request) => {
        const path = request.systemPrompt?.match(
          /<location>([^<]+\/dependency-skill\/SKILL\.md)<\/location>/,
        )?.[1];
        if (!path)
          throw new Error("Dependency skill missing from child request.");
        const script = join(dirname(path), "version.cjs");
        const marker = join(
          process.env.PI_CODING_AGENT_DIR ?? "",
          "skill-dependency-versions.txt",
        );
        return fauxAssistantMessage(
          fauxToolCall("bash", {
            command: `node ${JSON.stringify(script)} >> ${JSON.stringify(marker)}`,
          }),
          { stopReason: "toolUse" },
        );
      },
      fauxSubagentDone("Dependency skill script completed."),
    ]);
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("VERSION ISOLATION COMPLETE", 45_000);
    harness.assert(
      harness.read(
        join(harness.stateDirectory, "skill-dependency-versions.txt"),
      ) === "1.0.0\n2.0.0\n1.0.0\n",
      "Saved skill scripts did not execute isolated dependency generations on reopen.",
    );
  },
};
