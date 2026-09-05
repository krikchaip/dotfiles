import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cleanupRun, makeRunDirectory, PiTuiHarness } from "./harness.ts";

const root = resolve(import.meta.dir, "../../..");
const runDirectory = makeRunDirectory(root);
const capturePath = `${runDirectory}/tree-confirm-summary.json`;
const harness = await PiTuiHarness.start({
  name: "tree-confirm-summary",
  root,
  runDirectory,
  settings: { branchSummary: { skipPrompt: true } },
  extensions: [
    "extensions/test/e2e/fixture/tree-confirm-summary-probe.ts",
    "extensions/tree-confirm-summary.ts",
    "extensions/tree-confirm-summary.ts",
  ],
  environment: { PI_E2E_TREE_CONFIRM_CAPTURE: capturePath },
});

try {
  await harness.waitFor("TREE CONFIRM SUMMARY PROBE READY");
  const result = JSON.parse(readFileSync(capturePath, "utf8"));
  harness.assert(
    JSON.stringify(result.observed) === JSON.stringify([true, false, true]),
    `Expected plain/forced/plain skipPrompt values, got ${JSON.stringify(result.observed)}`,
  );
  harness.assert(result.restoredAfterShift === true, "Shift+Enter changed skipPrompt permanently");
  harness.assert(result.restoredAfterEscape === true, "Escape left skipPrompt overridden");
  await harness.finish();

  const nativeCwd = join(runDirectory, "tree-confirm-native-cwd");
  const nativeSessions = join(runDirectory, "tree-confirm-native-sessions");
  const nativeSession = join(nativeSessions, "native.jsonl");
  mkdirSync(nativeCwd, { recursive: true });
  mkdirSync(nativeSessions, { recursive: true });
  const nativeEntries = [
    { type: "session", version: 3, id: "88888888-8888-7888-8888-888888888888", timestamp: "2025-01-01T00:00:00.000Z", cwd: nativeCwd },
    { type: "message", id: "confirm-user", parentId: null, timestamp: "2025-01-01T00:00:01.000Z", message: { role: "user", content: [{ type: "text", text: "CONFIRM_USER" }], timestamp: 1735689601000 } },
    { type: "message", id: "confirm-assistant", parentId: "confirm-user", timestamp: "2025-01-01T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "CONFIRM_ASSISTANT" }], api: "openai-completions", provider: "confirm-e2e", model: "fake", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 1735689602000 } },
  ];
  writeFileSync(nativeSession, `${nativeEntries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  const nativeHarness = await PiTuiHarness.start({
    name: "tree-confirm-native",
    root,
    runDirectory,
    persistSession: true,
    settings: { branchSummary: { skipPrompt: true } },
    cliArguments: ["--session-dir", nativeSessions, "--session", nativeSession],
    extensions: ["extensions/tree-confirm-summary.ts"],
  });
  try {
    await nativeHarness.sendLiteral("/tree");
    await nativeHarness.sendKeys("Enter");
    await nativeHarness.waitFor("Session Tree");
    await nativeHarness.sendKeys("Up");
    await nativeHarness.sendLiteral("\x1b[13;2u");
    await nativeHarness.waitFor("Summarize branch?");
    await nativeHarness.sendKeys("Escape");
    await nativeHarness.waitFor("Session Tree");
    await nativeHarness.sendKeys("Escape");
    await nativeHarness.finish();
  } finally {
    await nativeHarness.abort().catch(() => undefined);
  }
  console.log("PASS tree-confirm-summary synthetic and native confirmation suite");
} finally {
  await harness.abort().catch(() => undefined);
  await cleanupRun(runDirectory);
}
