// TEST-ONLY: verifies that Pi can load an immutable shared-content generation.
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { E2EHarness, cleanupHarnessRun } from "../e2e/harness.ts";
import { configureBasicDelegation } from "../e2e/provider-support.ts";
import { capture, pin, prepare } from "./content-store.mjs";

const root = realpathSync(resolve(import.meta.dir, "../.."));
const runDirectory = mkdtempSync(join(tmpdir(), "content-pi-e2e-"));
const socket = join(runDirectory, "0.sock");
let oldPath = "";
let source = "";
let store = "";
let firstContent = "";
const owner = { pid: process.pid, token: randomUUID() };

const scenario: Scenario = {
  // The provider runs in a separate Pi process and routes through the catalog.
  // Reuse its existing basic-delegation case; only fixture preparation differs.
  name: "agent-disk-budget-warm-launch",
  process: {
    managed: true,
    offline: true,
    positionalPrompt: "Delegate the immutable content-generation test.",
  },
  async prepare(harness) {
    source = join(harness.stateDirectory, "authored-package");
    store = join(harness.stateDirectory, "prototype-content-store");
    mkdirSync(join(source, "support"), { recursive: true });
    writeFileSync(
      join(source, "package.json"),
      JSON.stringify({
        name: "sq-shared-content-fixture",
        version: "1.0.0",
        type: "module",
        pi: { extensions: ["index.js"] },
      }),
    );
    writeFileSync(
      join(source, "index.js"),
      "import version from './support/version.js'; export default function(pi) { pi.on('session_start', (_event, ctx) => ctx.ui.notify('SHARED CONTENT VERSION ' + version, 'info')); }\n",
    );
    writeFileSync(
      join(source, "support", "version.js"),
      "export default '1';\n",
    );
    const first = capture(source, store, owner);
    pin(store, first.id, randomUUID());
    oldPath = first.path;
    firstContent = first.content;
    writeFileSync(
      join(source, "support", "version.js"),
      "export default '2';\n",
    );
    capture(source, store, owner);
    writeFileSync(
      join(harness.stateDirectory, "settings.json"),
      JSON.stringify({
        packages: [oldPath],
        defaultProjectTrust: "always",
        compaction: { enabled: false },
      }),
    );
  },
  configureProvider(context) {
    configureBasicDelegation(context);
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("SUBAGENT COMPLETED");
    const manifest = JSON.parse(
      harness.read(harness.filesNamed("manifest.json")[0] ?? ""),
    );
    harness.assert(
      manifest.extensionPaths.includes(join(oldPath, "index.js")),
      "Child did not persist the exact saved version path.",
    );
    const childSession = harness.read(manifest.sessionPath);
    harness.assert(
      !childSession.includes("Failed to load"),
      "Child could not load the immutable Package.",
    );
    harness.assert(
      prepare(oldPath).content === firstContent,
      "Pi changed saved immutable Package content.",
    );
    console.log(
      "PASS real Pi child: readiness, relative helper import, exact saved v1, immutable shared file paths",
    );
  },
};

let harness: E2EHarness | undefined;
try {
  harness = await E2EHarness.start({
    root,
    extension: join(root, "index.ts"),
    runDirectory,
    scenario,
    socket,
  });
  await scenario.run(harness);
  await harness.finish();
} catch (error) {
  await harness?.abort();
  const log = join(runDirectory, `${scenario.name}.ansi`);
  if (existsSync(log))
    console.error(
      `Prototype terminal log: ${JSON.stringify(readFileSync(log, "utf8").slice(-6000))}`,
    );
  throw error;
} finally {
  await harness?.dispose();
  await cleanupHarnessRun([socket], runDirectory, false);
}
