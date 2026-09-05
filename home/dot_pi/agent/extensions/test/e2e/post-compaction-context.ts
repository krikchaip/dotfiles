import { cleanupRun, makeRunDirectory, PiTuiHarness } from "./harness.ts";
import {
  assertSimpleTurn,
  finish,
  isolatedHome,
  readEntries,
  root,
  sessionFiles,
  submitCommand,
} from "./generated-state-helpers.ts";

const runDirectory = makeRunDirectory(root);

async function nativeFooterTransition(): Promise<void> {
  const harness = await PiTuiHarness.start({
    name: "post-compaction-context-native",
    root,
    runDirectory,
    extensions: [
      "extensions/test/e2e/fixture/post-compaction-context-provider.ts",
      "extensions/post-compaction-context.ts",
      "extensions/test/e2e/fixture/generated-state-probe.ts",
    ],
    model: "post-compaction-context-e2e/fake",
    persistSession: true,
    settings: { compaction: { reserveTokens: 1_000, keepRecentTokens: 1 } },
  });

  await harness.submit("POST CONTEXT FIRST USER");
  await harness.waitFor("POST CONTEXT FIRST RESPONSE");
  await harness.submit("POST CONTEXT SECOND USER");
  await harness.waitFor("POST CONTEXT SECOND RESPONSE");
  await submitCommand(harness, "/e2e-compact");
  await harness.waitFor("E2E COMPACT COMPLETE", 12_000);
  const compactedPane = await harness.capture();
  const numericFooter = /\d+\.\d%\/8\.2k/;
  harness.assert(
    numericFooter.test(compactedPane) && !compactedPane.includes("?/8.2k"),
    `Post-compact footer was not numeric:\n${compactedPane}`,
  );

  await harness.submit("POST CONTEXT AFTER USER");
  await harness.waitFor("POST CONTEXT AFTER RESPONSE");
  const afterPane = await harness.capture();
  harness.assert(
    numericFooter.test(afterPane) && !afterPane.includes("?/8.2k"),
    `Post-response footer was not numeric:\n${afterPane}`,
  );
  await finish(harness);

  const entries = readEntries(sessionFiles(harness)[0]!);
  harness.assert(
    entries.filter((entry) => entry.type === "compaction").length === 1,
    "Native footer scenario did not persist one real compaction",
  );
  const lastAssistant = entries.findLast(
    (entry) => entry.type === "message" && (entry.message as { role?: string })?.role === "assistant",
  );
  const usage = (lastAssistant?.message as { usage?: { input?: number } } | undefined)?.usage;
  harness.assert(
    typeof usage?.input === "number" && usage.input > 0,
    "Native footer scenario did not transition to provider usage",
  );
  console.log("PASS post-compaction-context native-footer-transition");
}

try {
  const home = isolatedHome(runDirectory, "post-compaction-context");
  const harness = await PiTuiHarness.start({
    name: "post-compaction-context",
    root,
    runDirectory,
    extensions: [
      "extensions/test/e2e/fixture/compaction-probe.ts",
      "extensions/test/e2e/fixture/faux-provider.ts",
      "extensions/post-compaction-context.ts",
    ],
    model: "extension-e2e/fake",
    persistSession: true,
    environment: {
      HOME: home,
      PI_E2E_COMPACTION_PROBE: "post-compaction-context",
      PI_E2E_RESPONSES: JSON.stringify(["POST COMPACTION CONTEXT RESPONSE"]),
    },
  });

  await harness.waitFor("COMPACTION PROBE PASS post-compaction-context");
  await harness.submit("POST COMPACTION CONTEXT TURN");
  await harness.waitFor("POST COMPACTION CONTEXT RESPONSE");
  await finish(harness);
  assertSimpleTurn(
    harness,
    "POST COMPACTION CONTEXT TURN",
    "POST COMPACTION CONTEXT RESPONSE",
  );
  await nativeFooterTransition();
  console.log("PASS post-compaction-context");
} finally {
  await cleanupRun(runDirectory);
}
