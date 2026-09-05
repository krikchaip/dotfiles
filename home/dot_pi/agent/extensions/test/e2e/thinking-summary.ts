import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanupRun, makeRunDirectory, PiTuiHarness } from "./harness.ts";

const root = resolve(import.meta.dir, "../../..");
const runDirectory = makeRunDirectory(root);

async function nativeStreamingScenario(): Promise<void> {
  const native = await PiTuiHarness.start({
    name: "thinking-summary-native",
    root,
    runDirectory,
    extensions: [
      "extensions/thinking-summary.ts",
      "extensions/test/e2e/fixture/thinking-summary-native-provider.ts",
    ],
    model: "thinking-summary-native-e2e/fake",
    settings: { hideThinkingBlock: true },
    width: 78,
  });

  await native.submit("STREAM NATIVE THINKING");
  const streamingPane = await native.waitFor("Thinking: Native first summary", 8_000);
  native.assert(
    !streamingPane.includes("PRIVATE NATIVE FIRST DETAIL"),
    "Native streaming pane leaked hidden first detail",
  );
  const collapsed = await native.waitFor("NATIVE VISIBLE AFTER", 12_000);
  native.assert(collapsed.includes("Thinking: Native first summary"), "Native first summary missing");
  native.assert(collapsed.includes("Thinking: Native late summary"), "Native late summary missing");
  native.assert(collapsed.includes("NATIVE VISIBLE BETWEEN"), "Native interleaved text missing");
  native.assert(!collapsed.includes("PRIVATE NATIVE FIRST DETAIL"), "Collapsed first detail leaked");
  native.assert(!collapsed.includes("PRIVATE NATIVE LATE DETAIL"), "Collapsed late detail leaked");

  await native.sendKeys("C-t");
  const expanded = await native.waitFor("PRIVATE NATIVE LATE DETAIL", 5_000);
  native.assert(expanded.includes("PRIVATE NATIVE FIRST DETAIL"), "Native first detail did not expand");
  native.assert(!expanded.includes("Thinking: Native first summary"), "Collapsed summary remained expanded");

  await native.sendKeys("C-t");
  const collapsedAgain = await native.waitFor("Thinking: Native late summary", 5_000);
  native.assert(!collapsedAgain.includes("PRIVATE NATIVE FIRST DETAIL"), "Native first detail remained after collapse");

  await native.submit("NATIVE LENGTH REQUEST");
  const lengthPane = await native.waitFor("Response was truncated before completion.", 8_000);
  native.assert(lengthPane.includes("Thinking: Native length summary"), "Length response lost thinking summary");
  native.assert(!lengthPane.includes("PRIVATE LENGTH DETAIL"), "Length response leaked hidden detail");
  await native.submit("NATIVE ABORT REQUEST");
  const abortPane = await native.waitFor("Operation aborted", 8_000);
  native.assert(abortPane.includes("Thinking: Native abort summary"), "Aborted response lost thinking summary");
  native.assert(!abortPane.includes("PRIVATE ABORT DETAIL"), "Aborted response leaked hidden detail");
  await native.submit("NATIVE ERROR REQUEST");
  const errorPane = await native.waitFor("Error: NATIVE PROVIDER ERROR", 8_000);
  native.assert(errorPane.includes("Thinking: Native error summary"), "Error response lost thinking summary");
  native.assert(!errorPane.includes("PRIVATE ERROR DETAIL"), "Error response leaked hidden detail");
  await native.finish();
  console.log("PASS thinking-summary native-stream-collapse-toggle");
}

const capturePath = `${runDirectory}/thinking-summary.json`;
const harness = await PiTuiHarness.start({
  name: "thinking-summary",
  root,
  runDirectory,
  extensions: [
    "extensions/thinking-summary.ts",
    "extensions/test/e2e/fixture/thinking-summary-probe.ts",
  ],
  environment: { PI_E2E_THINKING_SUMMARY_CAPTURE: capturePath },
});

try {
  await harness.waitFor("THINKING SUMMARY PROBE READY");
  const result = JSON.parse(readFileSync(capturePath, "utf8"));
  const hiddenFirst = result.hiddenFirst.join("\n");
  harness.assert(hiddenFirst.includes("Thinking: First concise summary"), "First summary missing");
  harness.assert(hiddenFirst.includes("Thinking: Late separate summary"), "Late summary missing");
  harness.assert(hiddenFirst.includes("VISIBLE ANSWER BETWEEN"), "Interleaved text missing");
  harness.assert(hiddenFirst.includes("VISIBLE ANSWER AFTER"), "Trailing text missing");
  harness.assert(!hiddenFirst.includes("private first detail"), "Hidden thinking detail leaked");
  harness.assert(!hiddenFirst.includes("private late detail"), "Late hidden detail leaked");
  harness.assert(
    hiddenFirst.includes("TRANSFORMED assistant false"),
    "Assistant markdown transformer did not run after a failing transformer",
  );

  const hiddenUpdated = result.hiddenUpdated.join("\n");
  harness.assert(hiddenUpdated.includes("Thinking: Updated streaming summary"), "Streaming summary did not update");
  harness.assert(hiddenUpdated.includes("UPDATED ANSWER"), "Streaming text did not update");
  harness.assert(!hiddenUpdated.includes("First concise summary"), "Stale hidden render cache survived update");
  harness.assert(
    hiddenUpdated.includes("TRANSFORMED assistant true"),
    "Streaming markdown transformer context was not preserved",
  );

  const expanded = result.expandedLines.join("\n");
  harness.assert(expanded.includes("private first detail"), "Expanded thinking was replaced by summary");
  harness.assert(expanded.includes("private late detail"), "Expanded late thinking was replaced");

  const stopReasons = result.stopReasons as Record<string, string[]>;
  harness.assert(stopReasons.length.join("\n").includes("Response was truncated before completion."), "Length stop reason missing");
  harness.assert(stopReasons.aborted.join("\n").includes("CUSTOM ABORT"), "Custom aborted reason missing");
  harness.assert(stopReasons.defaultAborted.join("\n").includes("Operation aborted"), "Default aborted reason missing");
  harness.assert(stopReasons.error.join("\n").includes("Error: PROBE ERROR"), "Error stop reason missing");

  await harness.submit("/new");
  await harness.waitUntil("thinking summary new-session patch", () => {
    return (JSON.parse(readFileSync(capturePath, "utf8")) as { sessionStarts: number }).sessionStarts === 2;
  });
  await harness.submit("/reload");
  await harness.waitFor("Reloaded");
  await harness.waitUntil("thinking summary reload patch", () => {
    return (JSON.parse(readFileSync(capturePath, "utf8")) as { sessionStarts: number }).sessionStarts === 3;
  });
  await harness.finish();
  const log = readFileSync(harness.logPath, "utf8");
  harness.assert(!log.includes("Thinking summary failed:"), "Patch failed after load or reload");
  console.log("PASS thinking-summary historical rendering regression suite");
  await nativeStreamingScenario();
} finally {
  await harness.abort().catch(() => undefined);
  await cleanupRun(runDirectory);
}
