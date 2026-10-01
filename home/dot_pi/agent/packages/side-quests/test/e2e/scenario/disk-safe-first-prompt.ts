import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";

/**
 * Replays the observed human child shortcut without remote models or installers.
 */
export const diskSafeFirstPrompt: Scenario = {
  name: "disk-safe-human-child-first-prompt",
  timeoutMs: 20_000,
  process: {
    fauxProvider: true,
    persistSession: true,
    offline: true,
    arguments: ["--session", "./parent.jsonl"],
    extensionFixtures: ["../../extensions/new-child-split.ts"],
    globalAgentDefinitions: {
      specialist:
        "---\ndescription: Unused specialist\nskills: [fixture]\nextensions: true\n---\n",
    },
  },
  async prepare(harness) {
    writeFileSync(
      join(harness.workDirectory, "parent.jsonl"),
      `${JSON.stringify({ type: "session", version: 3, id: randomUUID(), timestamp: new Date().toISOString(), cwd: harness.workDirectory })}\n`,
    );
    const pkg = join(
      harness.stateDirectory,
      "npm",
      "node_modules",
      "sq-first-prompt-fixture",
    );
    mkdirSync(join(pkg, "skills", "fixture"), { recursive: true });
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({
        name: "sq-first-prompt-fixture",
        version: "1.0.0",
        pi: { extensions: ["index.ts"], skills: ["skills"] },
      }),
    );
    writeFileSync(
      join(pkg, "index.ts"),
      "export default function (pi) { pi.on('session_start', (_event, ctx) => ctx.ui.notify('WARM PACKAGE LOADED', 'info')); }\n",
    );
    writeFileSync(
      join(pkg, "skills", "fixture", "SKILL.md"),
      "---\nname: fixture\ndescription: Fixture\n---\nFixture instructions.\n",
    );
    writeFileSync(
      join(harness.stateDirectory, "settings.json"),
      JSON.stringify({
        packages: ["npm:sq-first-prompt-fixture@1.0.0"],
        defaultProjectTrust: "always",
        compaction: { enabled: false },
      }),
    );
  },
  configureProvider({ faux }) {
    faux.setResponses([
      fauxAssistantMessage("FIRST PROMPT COMPLETE WITHOUT PACKAGE ALLOCATION"),
    ]);
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("WARM PACKAGE LOADED");
    await harness.tmux(
      "send-keys",
      "-t",
      harness.parentPane,
      "-H",
      "1b",
      "5b",
      "31",
      "31",
      "30",
      "3b",
      "34",
      "75",
    );
    await harness.waitFor("New child session started");
    await harness.sendParent("Exercise the first human child prompt.", true);
    const view = await harness.waitFor(
      "FIRST PROMPT COMPLETE WITHOUT PACKAGE ALLOCATION",
    );
    harness.assert(
      !/automatic Package installation|Package snapshot|No space left|ctx is stale/.test(
        view,
      ),
      "First prompt reported a Package or stale-context error.",
    );
    const resources = join(harness.stateDirectory, "side-quests", "resources");
    harness.assert(
      !existsSync(resources) || readdirSync(resources).length === 0,
      "An ordinary child first prompt allocated Package snapshots.",
    );
  },
};
