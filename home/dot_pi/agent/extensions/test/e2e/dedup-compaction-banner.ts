import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupRun, makeRunDirectory, PiTuiHarness } from "./harness.ts";
import {
  finish,
  isolatedHome,
  messageEntry,
  readEntries,
  root,
  sessionFiles,
  submitCommand,
  writeHomeSettings,
  writeJsonl,
} from "./generated-state-helpers.ts";

const runDirectory = makeRunDirectory(root);

async function liveCompactionScenario(): Promise<void> {
  const name = "dedup-live-compaction";
  const home = isolatedHome(runDirectory, name);
  writeHomeSettings(home, { compaction: { keepRecentTokens: 1 } });
  const harness = await PiTuiHarness.start({
    name,
    root,
    runDirectory,
    extensions: [
      "extensions/test/e2e/fixture/faux-provider.ts",
      "extensions/test/e2e/fixture/generated-state-probe.ts",
      "extensions/dedup-compaction-banner.ts",
    ],
    model: "extension-e2e/fake",
    persistSession: true,
    settings: { compaction: { reserveTokens: 1_000, keepRecentTokens: 1 } },
    environment: {
      HOME: home,
      PI_E2E_RESPONSES: JSON.stringify([
        "LIVE DEDUP FIRST RESPONSE",
        "LIVE DEDUP SECOND RESPONSE",
        "LIVE DEDUP SUMMARY",
        "LIVE DEDUP TURN CONTEXT",
      ]),
    },
  });
  await harness.submit("LIVE DEDUP FIRST USER");
  await harness.waitFor("LIVE DEDUP FIRST RESPONSE");
  await harness.submit("LIVE DEDUP SECOND USER");
  await harness.waitFor("LIVE DEDUP SECOND RESPONSE");
  await submitCommand(harness, "/e2e-compact");
  await harness.waitFor("E2E COMPACT COMPLETE", 12_000);
  await harness.sendKeys("C-o");
  const pane = await harness.waitFor("LIVE DEDUP SUMMARY");
  harness.assert(
    (pane.match(/LIVE DEDUP SUMMARY/g) ?? []).length === 1,
    "Live compaction rendered a missing or duplicate compaction summary",
  );
  await finish(harness);
  harness.assert(
    readEntries(sessionFiles(harness)[0]!).filter((entry) => entry.type === "compaction").length === 1,
    "Live compaction did not persist exactly one entry",
  );
  console.log("PASS dedup-compaction-banner live-compaction");
}

try {
  await liveCompactionScenario();
  const name = "dedup-compaction-banner";
  const home = isolatedHome(runDirectory, name);
  const cwd = join(runDirectory, `${name}-cwd`);
  const sessionPath = join(runDirectory, "dedup-seeded.jsonl");
  const base = Date.UTC(2025, 0, 1);
  const seeded = [
    {
      type: "session",
      version: 3,
      id: "11111111-1111-7111-8111-111111111111",
      timestamp: new Date(base).toISOString(),
      cwd,
    },
    messageEntry("user-before", null, "user", "BEFORE COMPACTION USER", base + 1_000),
    messageEntry("assistant-before", "user-before", "assistant", "BEFORE COMPACTION ASSISTANT", base + 2_000),
    {
      type: "compaction",
      id: "seeded-compaction",
      parentId: "assistant-before",
      timestamp: new Date(base + 3_000).toISOString(),
      summary: "SEEDED COMPACTION SUMMARY",
      firstKeptEntryId: "user-after",
      tokensBefore: 1234,
      details: { readFiles: [], modifiedFiles: [] },
    },
    messageEntry("user-after", "seeded-compaction", "user", "AFTER COMPACTION USER", base + 4_000),
  ];
  const originalJsonl = writeJsonl(sessionPath, seeded);

  const harness = await PiTuiHarness.start({
    name,
    root,
    runDirectory,
    extensions: [
      "extensions/test/e2e/fixture/compaction-probe.ts",
      "extensions/test/e2e/fixture/faux-provider.ts",
      "extensions/dedup-compaction-banner.ts",
    ],
    model: "extension-e2e/fake",
    cliArguments: ["--session", sessionPath],
    persistSession: true,
    environment: {
      HOME: home,
      PI_E2E_COMPACTION_PROBE: "dedup-compaction-banner",
    },
  });

  await harness.waitFor("COMPACTION PROBE PASS dedup-compaction-banner");
  await harness.sendKeys("C-o");
  const pane = await harness.waitFor("SEEDED COMPACTION SUMMARY");
  harness.assert(
    (pane.match(/SEEDED COMPACTION SUMMARY/g) ?? []).length === 1,
    "Seeded compaction card was missing or duplicated",
  );
  await harness.finish();

  const finalJsonl = readFileSync(sessionPath, "utf8");
  harness.assert(finalJsonl.startsWith(originalJsonl), "Rendering changed a seeded JSONL line");
  const appendedLines = finalJsonl.slice(originalJsonl.length).split("\n").filter(Boolean);
  harness.assert(appendedLines.length === 1, `Expected one Pi startup entry, got ${appendedLines.length}`);
  const entries = readEntries(sessionPath);
  harness.assert(
    entries.slice(0, seeded.length).every(
      (entry, index) => JSON.stringify(entry) === JSON.stringify(seeded[index]),
    ),
    "Seeded JSONL entry sequence changed",
  );
  const startupEntry = entries.at(-1);
  harness.assert(
    startupEntry?.type === "thinking_level_change" &&
      startupEntry.parentId === "user-after" &&
      startupEntry.thinkingLevel === "off",
    "Unexpected Pi startup entry followed the seeded transcript",
  );
  console.log("PASS dedup-compaction-banner");
} catch (error) {
  throw error;
} finally {
  await cleanupRun(runDirectory);
}
