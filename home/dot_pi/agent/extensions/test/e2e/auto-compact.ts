import { existsSync, readFileSync } from "node:fs";
import { cleanupRun, makeRunDirectory, PiTuiHarness } from "./harness.ts";
import {
  assertSimpleTurn,
  finish,
  isolatedHome,
  readEntries,
  root,
  sessionFiles,
  submitCommand,
  writeHomeSettings,
} from "./generated-state-helpers.ts";

const runDirectory = makeRunDirectory(root);

async function nativeThresholdScenario(
  mode: "tool" | "final",
): Promise<void> {
  const name = `auto-compact-native-${mode}`;
  const home = isolatedHome(runDirectory, name);
  writeHomeSettings(home, {
    compaction: {
      model: "generated-state-e2e/gemini-fake",
      keepRecentTokens: 1,
      autoTrigger: { enabled: true, absoluteTokens: 1 },
    },
  });
  const currentCapture = `${runDirectory}/${name}-current.json`;
  const targetCapture = `${runDirectory}/${name}-target.json`;
  const harness = await PiTuiHarness.start({
    name,
    root,
    runDirectory,
    extensions: [
      "extensions/test/e2e/fixture/auto-compact-native-provider.ts",
      "extensions/test/e2e/fixture/generated-state-provider.ts",
      "extensions/auto-compact.ts",
    ],
    model: "auto-compact-native-e2e/fake",
    persistSession: true,
    settings: {
      compaction: { reserveTokens: 1_000, keepRecentTokens: 1 },
    },
    environment: {
      HOME: home,
      PI_E2E_AUTO_COMPACT_MODE: mode,
      PI_E2E_AUTO_COMPACT_CAPTURE: currentCapture,
      PI_E2E_GENERATED_PROVIDER_CAPTURE: targetCapture,
      PI_E2E_GENERATED_RESPONSES: JSON.stringify([
        `AUTO NATIVE ${mode.toUpperCase()} SUMMARY`,
      ]),
    },
  });

  await harness.submit("AUTO NATIVE HISTORY USER");
  await harness.waitFor("AUTO NATIVE HISTORY RESPONSE");
  await harness.submit(`AUTO NATIVE ${mode.toUpperCase()} USER`);
  await harness.waitFor(
    mode === "tool"
      ? "AUTO NATIVE CONTINUATION RESPONSE"
      : "AUTO NATIVE FINAL RESPONSE",
    15_000,
  );
  await harness.waitFor("auto-compact: compacted with", 15_000);
  await finish(harness);

  const entries = readEntries(sessionFiles(harness)[0]!);
  const compactions = entries.filter((entry) => entry.type === "compaction");
  harness.assert(
    compactions.length === 1,
    `Native ${mode} threshold persisted ${compactions.length} compactions`,
  );
  const targetCalls = JSON.parse(readFileSync(targetCapture, "utf8")) as unknown[];
  harness.assert(
    targetCalls.length === 1,
    `Native ${mode} threshold made ${targetCalls.length} target calls`,
  );
  const currentCalls = JSON.parse(readFileSync(currentCapture, "utf8")) as unknown[];
  if (mode === "tool") {
    harness.assert(currentCalls.length === 3, `Tool flow made ${currentCalls.length} provider calls`);
    const continuation = JSON.stringify(currentCalls[2]);
    harness.assert(
      continuation.includes("AUTO NATIVE TOOL RESULT"),
      "Tool continuation request omitted the completed tool result",
    );
    harness.assert(
      continuation.includes("AUTO NATIVE TOOL SUMMARY"),
      "Tool continuation request omitted the compaction summary",
    );
    harness.assert(
      !continuation.includes("Continue from the completed tool results"),
      "Hidden continuation instruction leaked into provider context",
    );
  } else {
    harness.assert(currentCalls.length === 2, `Final flow made ${currentCalls.length} provider calls`);
  }
  console.log(`PASS auto-compact native-${mode}-threshold`);
}

async function contextWindowFamilyScenario(): Promise<void> {
  const name = "auto-compact-context-window-family";
  const home = isolatedHome(runDirectory, name);
  writeHomeSettings(home, {
    compaction: {
      model: "generated-state-e2e/gemini-fake",
      keepRecentTokens: 1,
      autoTrigger: {
        enabled: true,
        absoluteTokens: "100k",
        contextWindowFamilies: {
          "1k": "100k",
          "8k": "100k",
          broken: "oops",
          "16k": 1,
        },
      },
    },
  });
  const currentCapture = `${runDirectory}/${name}-current.json`;
  const targetCapture = `${runDirectory}/${name}-target.json`;
  const harness = await PiTuiHarness.start({
    name,
    root,
    runDirectory,
    extensions: [
      "extensions/test/e2e/fixture/auto-compact-native-provider.ts",
      "extensions/test/e2e/fixture/generated-state-provider.ts",
      "extensions/auto-compact.ts",
    ],
    model: "auto-compact-native-e2e/fake",
    persistSession: true,
    settings: { compaction: { reserveTokens: 1_000, keepRecentTokens: 1 } },
    environment: {
      HOME: home,
      PI_E2E_AUTO_COMPACT_MODE: "final",
      PI_E2E_AUTO_COMPACT_CAPTURE: currentCapture,
      PI_E2E_GENERATED_PROVIDER_CAPTURE: targetCapture,
      PI_E2E_GENERATED_RESPONSES: JSON.stringify(
        Array<string>(8).fill("FAMILY FLOOR SUMMARY"),
      ),
    },
  });

  await harness.submit("FAMILY FLOOR HISTORY USER");
  await harness.waitFor("AUTO NATIVE HISTORY RESPONSE");
  await harness.waitFor(
    "auto-compact: invalid contextWindowFamilies entry broken:oops",
  );
  writeHomeSettings(home, {
    compaction: {
      model: "generated-state-e2e/gemini-fake",
      keepRecentTokens: 1,
      autoTrigger: {
        enabled: true,
        absoluteTokens: "100k",
        contextWindowFamilies: {
          "1k": "100k",
          "8k": 1,
          broken: "oops",
          "16k": 1,
        },
      },
    },
  });
  await harness.submit("FAMILY FLOOR FINAL USER");
  await harness.waitFor("AUTO NATIVE FINAL RESPONSE");
  const threshold = await harness.waitFor(
    "contextWindowFamilies 8k -> 1",
    15_000,
  );
  harness.assert(
    !threshold.includes("contextWindowFamilies 1k -> 100k"),
    "Auto compact selected a lower context-window floor",
  );
  await harness.waitFor("auto-compact: compacted with", 15_000);
  await finish(harness);

  const targetCalls = JSON.parse(readFileSync(targetCapture, "utf8")) as unknown[];
  harness.assert(
    targetCalls.length > 0,
    "Context-window floor did not use the configured compaction model",
  );
  harness.assert(
    readEntries(sessionFiles(harness)[0]!).filter(
      (entry) => entry.type === "compaction",
    ).length === 1,
    "Context-window floor did not persist one compaction",
  );
  console.log("PASS auto-compact context-window-family-floor-and-malformed");
}

async function absoluteTokensSuppressionScenario(): Promise<void> {
  const name = "auto-compact-absolute-suppression";
  const home = isolatedHome(runDirectory, name);
  writeHomeSettings(home, {
    compaction: {
      model: "generated-state-e2e/gemini-fake",
      keepRecentTokens: 1,
      autoTrigger: {
        enabled: true,
        absoluteTokens: 1,
        contextWindowFamilies: { "8k": "100k" },
      },
    },
  });
  const currentCapture = `${runDirectory}/${name}-current.json`;
  const targetCapture = `${runDirectory}/${name}-target.json`;
  const harness = await PiTuiHarness.start({
    name,
    root,
    runDirectory,
    extensions: [
      "extensions/test/e2e/fixture/auto-compact-native-provider.ts",
      "extensions/test/e2e/fixture/generated-state-provider.ts",
      "extensions/auto-compact.ts",
    ],
    model: "auto-compact-native-e2e/fake",
    persistSession: true,
    settings: { compaction: { reserveTokens: 1_000, keepRecentTokens: 1 } },
    environment: {
      HOME: home,
      PI_E2E_AUTO_COMPACT_MODE: "final",
      PI_E2E_AUTO_COMPACT_CAPTURE: currentCapture,
      PI_E2E_GENERATED_PROVIDER_CAPTURE: targetCapture,
      PI_E2E_GENERATED_RESPONSES: JSON.stringify([
        "ABSOLUTE TOKENS MUST NOT RUN",
      ]),
    },
  });

  await harness.submit("ABSOLUTE SUPPRESSION HISTORY USER");
  await harness.waitFor("AUTO NATIVE HISTORY RESPONSE");
  await harness.submit("ABSOLUTE SUPPRESSION FINAL USER");
  await harness.waitFor("AUTO NATIVE FINAL RESPONSE");
  await Bun.sleep(500);
  const pane = await harness.capture();
  harness.assert(
    !pane.includes("auto-compact threshold reached"),
    "absoluteTokens triggered while contextWindowFamilies was non-empty",
  );
  await finish(harness);

  harness.assert(
    !existsSync(targetCapture),
    "Suppressed absoluteTokens made a compaction target call",
  );
  harness.assert(
    readEntries(sessionFiles(harness)[0]!).every(
      (entry) => entry.type !== "compaction",
    ),
    "Suppressed absoluteTokens persisted a compaction",
  );
  console.log("PASS auto-compact absoluteTokens-suppressed-by-families");
}

async function queuedFinalScenario(): Promise<void> {
  const name = "auto-compact-final-queue";
  const home = isolatedHome(runDirectory, name);
  writeHomeSettings(home, {
    compaction: {
      model: "generated-state-e2e/gemini-fake",
      keepRecentTokens: 1,
      autoTrigger: { enabled: false, absoluteTokens: 1 },
    },
  });
  const capturePath = `${runDirectory}/${name}-current.json`;
  const harness = await PiTuiHarness.start({
    name,
    root,
    runDirectory,
    extensions: [
      "extensions/test/e2e/fixture/auto-compact-native-provider.ts",
      "extensions/test/e2e/fixture/generated-state-provider.ts",
      "extensions/auto-compact.ts",
    ],
    model: "auto-compact-native-e2e/fake",
    persistSession: true,
    settings: { compaction: { reserveTokens: 1_000, keepRecentTokens: 1 } },
    environment: {
      HOME: home,
      PI_E2E_AUTO_COMPACT_MODE: "queue",
      PI_E2E_AUTO_COMPACT_CAPTURE: capturePath,
      PI_E2E_GENERATED_RESPONSES: JSON.stringify([
        "AUTO QUEUE SUMMARY",
        "AUTO QUEUE TURN CONTEXT",
      ]),
      PI_E2E_RESPONSE_DELAYS_MS: JSON.stringify([1_200, 0]),
    },
  });

  await harness.submit("AUTO NATIVE HISTORY USER");
  await harness.waitFor("AUTO NATIVE HISTORY RESPONSE");
  await Bun.sleep(500);
  writeHomeSettings(home, {
    compaction: {
      model: "generated-state-e2e/gemini-fake",
      keepRecentTokens: 1,
      autoTrigger: { enabled: true, absoluteTokens: 1 },
    },
  });
  await harness.submit("AUTO NATIVE FINAL USER");
  await harness.waitFor("compacting with generated-state-e2e/gemini-fake", 8_000);
  await harness.submit("AUTO NATIVE QUEUED USER");
  await harness.waitFor("AUTO NATIVE QUEUED RESPONSE", 12_000);
  await finish(harness);

  const calls = JSON.parse(readFileSync(capturePath, "utf8")) as unknown[];
  harness.assert(calls.length === 3, `Queued final flow made ${calls.length} current-model calls`);
  harness.assert(
    JSON.stringify(calls[2]).includes("AUTO NATIVE QUEUED USER"),
    "Queued user message was not resumed after final-answer compaction",
  );
  harness.assert(
    readEntries(sessionFiles(harness)[0]!).filter((entry) => entry.type === "compaction").length === 1,
    "Queued final flow did not persist exactly one compaction",
  );
  console.log("PASS auto-compact final-answer-queue");
}

async function failureBackoffScenario(): Promise<void> {
  const name = "auto-compact-failure-backoff";
  const home = isolatedHome(runDirectory, name);
  writeHomeSettings(home, {
    compaction: {
      keepRecentTokens: 1,
      autoTrigger: { enabled: true, absoluteTokens: 1 },
    },
  });
  const capturePath = `${runDirectory}/${name}-current.json`;
  const harness = await PiTuiHarness.start({
    name,
    root,
    runDirectory,
    extensions: [
      "extensions/test/e2e/fixture/auto-compact-native-provider.ts",
      "extensions/auto-compact.ts",
    ],
    model: "auto-compact-native-e2e/fake",
    persistSession: true,
    settings: { compaction: { reserveTokens: 1_000, keepRecentTokens: 1 } },
    environment: {
      HOME: home,
      PI_E2E_AUTO_COMPACT_MODE: "failure",
      PI_E2E_AUTO_COMPACT_CAPTURE: capturePath,
    },
  });

  await harness.submit("AUTO FAILURE HISTORY USER");
  await harness.waitFor("AUTO FAILURE HISTORY RESPONSE");
  await harness.waitFor("AUTO FAILURE COMPACTION ERROR", 12_000);
  await Bun.sleep(300);
  harness.assert(
    readEntries(sessionFiles(harness)[0]!).every((entry) => entry.type !== "compaction"),
    "PRODUCT DEFECT: failed automatic compaction persisted an entry, so failure backoff was not armed",
  );
  await harness.submit("AUTO FAILURE BACKOFF USER");
  await harness.waitFor("AUTO FAILURE BACKOFF RESPONSE");
  await Bun.sleep(300);
  harness.assert(
    readEntries(sessionFiles(harness)[0]!).every((entry) => entry.type !== "compaction"),
    "PRODUCT DEFECT: failed automatic compaction did not arm one-turn backoff",
  );
  await harness.submit("AUTO FAILURE RETRY USER");
  await harness.waitFor("auto-compact: compacted with", 12_000);
  await finish(harness);

  const calls = JSON.parse(readFileSync(capturePath, "utf8")) as unknown[];
  harness.assert(calls.length === 5, `Failure/backoff flow made ${calls.length} calls`);
  harness.assert(
    readEntries(sessionFiles(harness)[0]!).filter((entry) => entry.type === "compaction").length === 1,
    "Failure/backoff retry did not persist one compaction",
  );
  console.log("PASS auto-compact failure-backoff-retry");
}

async function staleSessionScenario(): Promise<void> {
  const name = "auto-compact-stale-session";
  const home = isolatedHome(runDirectory, name);
  writeHomeSettings(home, {
    compaction: {
      model: "generated-state-e2e/gemini-fake",
      keepRecentTokens: 1,
      autoTrigger: { enabled: true, absoluteTokens: 1 },
    },
  });
  const currentCapture = `${runDirectory}/${name}-current.json`;
  const sessionCapture = `${runDirectory}/${name}-sessions.json`;
  const harness = await PiTuiHarness.start({
    name,
    root,
    runDirectory,
    extensions: [
      "extensions/test/e2e/fixture/auto-compact-native-provider.ts",
      "extensions/test/e2e/fixture/generated-state-provider.ts",
      "extensions/auto-compact.ts",
      "extensions/test/e2e/fixture/auto-compact-session-probe.ts",
    ],
    model: "auto-compact-native-e2e/fake",
    persistSession: true,
    settings: { compaction: { reserveTokens: 1_000, keepRecentTokens: 1 } },
    environment: {
      HOME: home,
      PI_E2E_AUTO_COMPACT_MODE: "tool",
      PI_E2E_AUTO_COMPACT_CAPTURE: currentCapture,
      PI_E2E_AUTO_COMPACT_SESSION_CAPTURE: sessionCapture,
      PI_E2E_GENERATED_RESPONSES: JSON.stringify(["STALE SUMMARY MUST NOT RESUME"]),
      PI_E2E_RESPONSE_DELAYS_MS: JSON.stringify([1_500]),
    },
  });
  await harness.submit("AUTO STALE HISTORY USER");
  await harness.waitFor("AUTO NATIVE HISTORY RESPONSE");
  await harness.submit("AUTO STALE TOOL USER");
  await harness.waitFor("compacting with generated-state-e2e/gemini-fake", 8_000);
  await harness.submit("/new");
  await harness.waitUntil("new session during compaction", () => {
    if (!existsSync(sessionCapture)) return false;
    return (JSON.parse(readFileSync(sessionCapture, "utf8")) as { starts: number }).starts === 2;
  });
  await Bun.sleep(1_700);
  const pane = await harness.capture();
  harness.assert(!pane.includes("AUTO NATIVE CONTINUATION RESPONSE"), "Stale compaction resumed the old tool turn");
  harness.assert(
    (JSON.parse(readFileSync(currentCapture, "utf8")) as unknown[]).length === 2,
    "Stale compaction made a continuation provider call",
  );
  await finish(harness);
  console.log("PASS auto-compact stale-session");
}

async function modelScenario(
  name: string,
  targetModel: string,
  expectedSummary: string,
  targetShouldRun: boolean,
  targetShouldError = false,
): Promise<void> {
  const home = isolatedHome(runDirectory, name);
  writeHomeSettings(home, {
    compaction: { model: targetModel, keepRecentTokens: 1 },
  });
  const currentCapture = `${runDirectory}/${name}-current.json`;
  const targetCapture = `${runDirectory}/${name}-target.json`;
  const harness = await PiTuiHarness.start({
    name,
    root,
    runDirectory,
    extensions: [
      "extensions/test/e2e/fixture/faux-provider.ts",
      "extensions/test/e2e/fixture/generated-state-provider.ts",
      "extensions/auto-compact.ts",
      "extensions/test/e2e/fixture/generated-state-probe.ts",
    ],
    model: "extension-e2e/fake",
    persistSession: true,
    settings: {
      compaction: { reserveTokens: 1_000, keepRecentTokens: 1 },
    },
    environment: {
      HOME: home,
      PI_E2E_PROVIDER_CAPTURE: currentCapture,
      PI_E2E_GENERATED_PROVIDER_CAPTURE: targetCapture,
      PI_E2E_RESPONSES: JSON.stringify([
        `${name} FIRST RESPONSE`,
        `${name} SECOND RESPONSE`,
        ...Array<string>(8).fill(expectedSummary),
      ]),
      PI_E2E_GENERATED_RESPONSES: JSON.stringify(
        Array<string>(8).fill(
          targetShouldError ? "TARGET COMPACTION ERROR" : expectedSummary,
        ),
      ),
      ...(targetShouldError
        ? { PI_E2E_GENERATED_ERROR_INDEXES: JSON.stringify([0]) }
        : {}),
    },
  });

  await harness.submit(`${name} FIRST USER`);
  await harness.waitFor(`${name} FIRST RESPONSE`);
  await harness.submit(`${name} SECOND USER`);
  await harness.waitFor(`${name} SECOND RESPONSE`);
  await submitCommand(harness, "/e2e-compact");
  await harness.waitFor("auto-compact: compacted with", 12_000);
  await finish(harness);

  const currentCalls = JSON.parse(readFileSync(currentCapture, "utf8")) as unknown[];
  harness.assert(
    targetShouldRun && !targetShouldError
      ? currentCalls.length === 2
      : currentCalls.length > 2,
    `Current-model call count changed: ${currentCalls.length}`,
  );
  const targetCalls = Bun.file(targetCapture).size
    ? (JSON.parse(readFileSync(targetCapture, "utf8")) as unknown[])
    : [];
  harness.assert(
    targetShouldRun ? targetCalls.length > 0 : targetCalls.length === 0,
    `Compaction target call count changed: ${targetCalls.length}`,
  );
  if (targetShouldRun && !targetShouldError) {
    harness.assert(
      targetCalls.some((call) =>
        JSON.stringify(call).includes("FOCUS ON COMPACTION REGRESSION"),
      ),
      "Configured compaction request lost custom instructions",
    );
  }

  const files = sessionFiles(harness);
  harness.assert(files.length === 1, `Expected one compaction JSONL, got ${files.length}`);
  const entries = readEntries(files[0]!);
  harness.assert(
    entries.filter((entry) => entry.type === "message").length === 4,
    "Compaction scenario JSONL does not contain exactly two turns",
  );
  const compactions = entries.filter((entry) => entry.type === "compaction");
  harness.assert(compactions.length === 1, "Manual compact did not persist exactly one entry");
  const expectedPersistedSummary =
    `${expectedSummary}\n\n---\n\n` +
    `**Turn Context (split turn):**\n\n${expectedSummary}`;
  harness.assert(
    compactions[0]?.summary === expectedPersistedSummary,
    `Persisted compaction summary changed: ${String(compactions[0]?.summary)}`,
  );
  console.log(`PASS auto-compact ${name}`);
}

try {
  const home = isolatedHome(runDirectory, "auto-compact");
  writeHomeSettings(home, {
    compaction: {
      autoTrigger: { enabled: true, absoluteTokens: 1 },
    },
  });
  const harness = await PiTuiHarness.start({
    name: "auto-compact",
    root,
    runDirectory,
    extensions: [
      "extensions/test/e2e/fixture/compaction-probe.ts",
      "extensions/test/e2e/fixture/faux-provider.ts",
      "extensions/auto-compact.ts",
    ],
    model: "extension-e2e/fake",
    persistSession: true,
    environment: {
      HOME: home,
      PI_E2E_COMPACTION_PROBE: "auto-compact",
      PI_E2E_RESPONSES: JSON.stringify(["AUTO COMPACT TURN RESPONSE"]),
    },
  });

  await harness.waitFor("COMPACTION PROBE PASS auto-compact");
  await harness.submit("AUTO COMPACT ONE SHORT TURN");
  await harness.waitFor("AUTO COMPACT TURN RESPONSE");
  await Bun.sleep(250);
  const pane = await harness.capture();
  harness.assert(
    !pane.includes("auto-compact threshold reached"),
    "An empty early-compaction attempt reached the compactor",
  );
  await finish(harness);

  assertSimpleTurn(
    harness,
    "AUTO COMPACT ONE SHORT TURN",
    "AUTO COMPACT TURN RESPONSE",
  );
  const raw = readFileSync(sessionFiles(harness)[0]!, "utf8");
  harness.assert(
    !raw.includes("auto-compact-continuation"),
    "A synthetic continuation persisted for an empty compaction attempt",
  );

  await nativeThresholdScenario("tool");
  await nativeThresholdScenario("final");
  await contextWindowFamilyScenario();
  await absoluteTokensSuppressionScenario();
  const defects: string[] = [];
  try {
    await failureBackoffScenario();
  } catch (error) {
    defects.push(error instanceof Error ? error.message : String(error));
    console.error(`FAIL auto-compact failure-backoff: ${defects.at(-1)}`);
  }
  try {
    await staleSessionScenario();
  } catch (error) {
    defects.push(error instanceof Error ? error.message : String(error));
    console.error(`FAIL auto-compact stale-session: ${defects.at(-1)}`);
  }
  await modelScenario(
    "auto-compact-model-override",
    "generated-state-e2e/gemini-fake",
    "TARGET COMPACTION SUMMARY",
    true,
  );
  await modelScenario(
    "auto-compact-auth-fallback",
    "generated-state-noauth/gemini-noauth",
    "AUTH COMPACTION FALLBACK",
    false,
  );
  await modelScenario(
    "auto-compact-error-fallback",
    "generated-state-e2e/gemini-fake",
    "ERROR COMPACTION FALLBACK",
    true,
    true,
  );
  try {
    await queuedFinalScenario();
  } catch (error) {
    defects.push(error instanceof Error ? error.message : String(error));
    console.error(`FAIL auto-compact final-answer-queue: ${defects.at(-1)}`);
  }
  if (defects.length > 0) {
    throw new Error(`auto-compact deterministic product defects:\n${defects.join("\n")}`);
  }
  console.log("PASS auto-compact");
} finally {
  await cleanupRun(runDirectory);
}
