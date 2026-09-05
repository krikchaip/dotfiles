import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupRun, makeRunDirectory, PiTuiHarness } from "./harness.ts";
import {
  finish,
  isolatedHome,
  readEntries,
  root,
  sessionFiles,
  submitCommand,
  writeHomeSettings,
} from "./generated-state-helpers.ts";

const runDirectory = makeRunDirectory(root);
const summaryPrefix =
  "The user explored a different conversation branch before returning here.\n" +
  "Summary of that exploration:\n\n";

async function fallbackScenario(
  name: string,
  targetModel: string | undefined,
  fallbackSummary: string,
  targetShouldRun: boolean,
): Promise<void> {
  const home = isolatedHome(runDirectory, name);
  writeHomeSettings(home, {
    branchSummary: { model: targetModel, reserveTokens: 1_000 },
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
      "extensions/branch-summary-model.ts",
      "extensions/test/e2e/fixture/generated-state-probe.ts",
    ],
    model: "extension-e2e/fake",
    persistSession: true,
    environment: {
      HOME: home,
      PI_E2E_PROVIDER_CAPTURE: currentCapture,
      PI_E2E_GENERATED_PROVIDER_CAPTURE: targetCapture,
      PI_E2E_RESPONSES: JSON.stringify([
        `${name} FIRST RESPONSE`,
        `${name} SECOND RESPONSE`,
        fallbackSummary,
      ]),
      PI_E2E_GENERATED_RESPONSES: JSON.stringify(["TARGET SUMMARY ERROR"]),
      ...(targetShouldRun
        ? { PI_E2E_GENERATED_ERROR_INDEXES: JSON.stringify([0]) }
        : {}),
    },
  });

  await harness.submit(`${name} FIRST USER`);
  await harness.waitFor(`${name} FIRST RESPONSE`);
  await harness.submit(`${name} SECOND USER`);
  await harness.waitFor(`${name} SECOND RESPONSE`);
  await submitCommand(harness, "/e2e-branch-summary");
  await harness.waitFor("E2E BRANCH SUMMARY COMPLETE", 12_000);
  await finish(harness);

  const currentCalls = JSON.parse(readFileSync(currentCapture, "utf8")) as unknown[];
  harness.assert(
    currentCalls.length === 3,
    `Fallback provider expected three calls, got ${currentCalls.length}`,
  );
  harness.assert(
    JSON.stringify(currentCalls[2]).includes("FOCUS ON BRANCH REGRESSION"),
    "Fallback summary request lost custom instructions",
  );
  const targetCalls = Bun.file(targetCapture).size
    ? (JSON.parse(readFileSync(targetCapture, "utf8")) as unknown[])
    : [];
  harness.assert(
    targetCalls.length === (targetShouldRun ? 1 : 0),
    `Target provider call count changed: ${targetCalls.length}`,
  );

  const files = sessionFiles(harness);
  harness.assert(files.length === 1, `Expected one fallback session JSONL, got ${files.length}`);
  const summaries = readEntries(files[0]!).filter(
    (entry) => entry.type === "branch_summary",
  );
  harness.assert(summaries.length === 1, "Fallback did not persist exactly one branch summary");
  harness.assert(
    summaries[0]?.summary === `${summaryPrefix}${fallbackSummary}`,
    "Fallback summary wrapper or text changed",
  );
  console.log(`PASS branch-summary-model ${name}`);
}

function writeProjectSettings(name: string, contents: unknown): void {
  const projectDirectory = join(runDirectory, `${name}-cwd`, ".pi");
  mkdirSync(projectDirectory, { recursive: true });
  writeFileSync(
    join(projectDirectory, "settings.json"),
    typeof contents === "string" ? contents : JSON.stringify(contents),
  );
}

async function projectPrecedenceScenario(): Promise<void> {
  const name = "branch-summary-project-precedence";
  const home = isolatedHome(runDirectory, name);
  writeHomeSettings(home, {
    branchSummary: {
      model: "generated-state-noauth/gemini-noauth",
      reserveTokens: 1_000,
    },
  });
  writeProjectSettings(name, {
    branchSummary: {
      model: "generated-state-e2e/gemini-fake",
      reserveTokens: "1k",
    },
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
      "extensions/branch-summary-model.ts",
      "extensions/test/e2e/fixture/generated-state-probe.ts",
    ],
    model: "extension-e2e/fake",
    persistSession: true,
    cliArguments: ["--approve"],
    environment: {
      HOME: home,
      PI_E2E_PROVIDER_CAPTURE: currentCapture,
      PI_E2E_GENERATED_PROVIDER_CAPTURE: targetCapture,
      PI_E2E_RESPONSES: JSON.stringify([
        "PROJECT PRECEDENCE FIRST RESPONSE",
        "PROJECT PRECEDENCE SECOND RESPONSE",
        "GLOBAL SETTINGS FALLBACK MUST NOT RUN",
      ]),
      PI_E2E_GENERATED_RESPONSES: JSON.stringify([
        "PROJECT SETTINGS SUMMARY",
      ]),
    },
  });

  await harness.submit("PROJECT PRECEDENCE FIRST USER");
  await harness.waitFor("PROJECT PRECEDENCE FIRST RESPONSE");
  await harness.submit("PROJECT PRECEDENCE SECOND USER");
  await harness.waitFor("PROJECT PRECEDENCE SECOND RESPONSE");
  await submitCommand(harness, "/e2e-branch-summary");
  await harness.waitFor("E2E BRANCH SUMMARY COMPLETE", 12_000);
  await finish(harness);

  const currentCalls = JSON.parse(readFileSync(currentCapture, "utf8")) as unknown[];
  const targetCalls = JSON.parse(readFileSync(targetCapture, "utf8")) as unknown[];
  harness.assert(
    currentCalls.length === 2 && targetCalls.length === 1,
    `Project settings precedence made ${currentCalls.length} current and ${targetCalls.length} target calls`,
  );
  const summaries = readEntries(sessionFiles(harness)[0]!).filter(
    (entry) => entry.type === "branch_summary",
  );
  harness.assert(
    summaries[0]?.summary === `${summaryPrefix}PROJECT SETTINGS SUMMARY`,
    "Project branch-summary settings did not override global settings",
  );
  console.log("PASS branch-summary-model project-settings-precedence");
}

async function malformedProjectSettingsScenario(): Promise<void> {
  const name = "branch-summary-malformed-project-settings";
  const home = isolatedHome(runDirectory, name);
  writeHomeSettings(home, {
    branchSummary: {
      model: "generated-state-e2e/gemini-fake",
      reserveTokens: 1_000,
    },
  });
  writeProjectSettings(name, "{");
  const targetCapture = `${runDirectory}/${name}-target.json`;
  const harness = await PiTuiHarness.start({
    name,
    root,
    runDirectory,
    extensions: [
      "extensions/test/e2e/fixture/faux-provider.ts",
      "extensions/test/e2e/fixture/generated-state-provider.ts",
      "extensions/branch-summary-model.ts",
      "extensions/test/e2e/fixture/generated-state-probe.ts",
    ],
    model: "extension-e2e/fake",
    persistSession: true,
    cliArguments: ["--approve"],
    environment: {
      HOME: home,
      PI_E2E_GENERATED_PROVIDER_CAPTURE: targetCapture,
      PI_E2E_RESPONSES: JSON.stringify([
        "MALFORMED PROJECT FIRST RESPONSE",
        "MALFORMED PROJECT SECOND RESPONSE",
      ]),
      PI_E2E_GENERATED_RESPONSES: JSON.stringify([
        "MALFORMED PROJECT GLOBAL FALLBACK SUMMARY",
      ]),
    },
  });

  await harness.submit("MALFORMED PROJECT FIRST USER");
  await harness.waitFor("MALFORMED PROJECT FIRST RESPONSE");
  await harness.submit("MALFORMED PROJECT SECOND USER");
  await harness.waitFor("MALFORMED PROJECT SECOND RESPONSE");
  await submitCommand(harness, "/e2e-branch-summary");
  await harness.waitFor("E2E BRANCH SUMMARY COMPLETE", 12_000);
  await finish(harness);

  const targetCalls = JSON.parse(readFileSync(targetCapture, "utf8")) as unknown[];
  harness.assert(
    targetCalls.length === 1,
    `Malformed project settings fallback made ${targetCalls.length} target calls`,
  );
  const summaries = readEntries(sessionFiles(harness)[0]!).filter(
    (entry) => entry.type === "branch_summary",
  );
  harness.assert(
    summaries[0]?.summary ===
      `${summaryPrefix}MALFORMED PROJECT GLOBAL FALLBACK SUMMARY`,
    "Malformed project settings did not preserve valid global settings",
  );
  console.log("PASS branch-summary-model malformed-project-settings-fallback");
}

async function abortScenario(): Promise<void> {
  const name = "branch-summary-abort";
  const home = isolatedHome(runDirectory, name);
  writeHomeSettings(home, {
    branchSummary: { model: "generated-state-e2e/gemini-fake", reserveTokens: 1_000 },
  });
  const capturePath = `${runDirectory}/${name}-target.json`;
  const harness = await PiTuiHarness.start({
    name,
    root,
    runDirectory,
    extensions: [
      "extensions/test/e2e/fixture/faux-provider.ts",
      "extensions/test/e2e/fixture/generated-state-provider.ts",
      "extensions/branch-summary-model.ts",
      "extensions/test/e2e/fixture/generated-state-probe.ts",
    ],
    model: "extension-e2e/fake",
    persistSession: true,
    environment: {
      HOME: home,
      PI_E2E_GENERATED_PROVIDER_CAPTURE: capturePath,
      PI_E2E_RESPONSES: JSON.stringify(["ABORT FIRST RESPONSE", "ABORT SECOND RESPONSE"]),
      PI_E2E_GENERATED_RESPONSES: JSON.stringify(["ABORT SUMMARY MUST NOT PERSIST"]),
      PI_E2E_GENERATED_ABORT_INDEXES: JSON.stringify([0]),
    },
  });
  await harness.submit("ABORT FIRST USER");
  await harness.waitFor("ABORT FIRST RESPONSE");
  await harness.submit("ABORT SECOND USER");
  await harness.waitFor("ABORT SECOND RESPONSE");
  await submitCommand(harness, "/e2e-branch-summary");
  await harness.waitFor("E2E BRANCH SUMMARY CANCELLED", 8_000);
  await finish(harness);
  harness.assert(
    readEntries(sessionFiles(harness)[0]!).every((entry) => entry.type !== "branch_summary"),
    "Aborted branch summary persisted an entry",
  );
  console.log("PASS branch-summary-model abort");
}

try {
  const name = "branch-summary-model";
  const home = isolatedHome(runDirectory, name);
  writeHomeSettings(home, {
    branchSummary: {
      model: { provider: "generated-state-e2e", id: "gemini-fake" },
      reserveTokens: "1k",
    },
  });
  const capturePath = `${runDirectory}/branch-summary-provider.json`;
  const harness = await PiTuiHarness.start({
    name,
    root,
    runDirectory,
    extensions: [
      "extensions/test/e2e/fixture/faux-provider.ts",
      "extensions/test/e2e/fixture/generated-state-provider.ts",
      "extensions/branch-summary-model.ts",
      "extensions/test/e2e/fixture/generated-state-probe.ts",
    ],
    model: "extension-e2e/fake",
    persistSession: true,
    environment: {
      HOME: home,
      PI_E2E_GENERATED_PROVIDER_CAPTURE: capturePath,
      PI_E2E_RESPONSES: JSON.stringify([
        "BRANCH FIRST RESPONSE",
        "BRANCH SECOND RESPONSE",
      ]),
      PI_E2E_GENERATED_RESPONSES: JSON.stringify([
        "DETERMINISTIC BRANCH SUMMARY",
      ]),
    },
  });

  await harness.submit("BRANCH FIRST USER");
  await harness.waitFor("BRANCH FIRST RESPONSE");
  await harness.submit("BRANCH SECOND USER");
  await harness.waitFor("BRANCH SECOND RESPONSE");
  await submitCommand(harness, "/e2e-branch-summary");
  await harness.waitFor("E2E BRANCH SUMMARY COMPLETE", 12_000);
  await finish(harness);

  const captures = JSON.parse(readFileSync(capturePath, "utf8")) as unknown[];
  harness.assert(
    captures.length === 1,
    `Configured summary provider expected one call, got ${captures.length}`,
  );
  const summaryRequest = JSON.stringify(captures[0]);
  harness.assert(
    summaryRequest.includes("FOCUS ON BRANCH REGRESSION"),
    "Summary request lost custom instructions",
  );
  harness.assert(
    summaryRequest.includes("BRANCH SECOND USER") && summaryRequest.includes("BRANCH SECOND RESPONSE"),
    "Summary request omitted the abandoned branch",
  );

  const files = sessionFiles(harness);
  harness.assert(files.length === 1, `Expected one session JSONL, got ${files.length}`);
  const entries = readEntries(files[0]!);
  harness.assert(
    entries.filter((entry) => entry.type === "message").length === 4,
    "Session JSONL does not contain exactly two complete turns",
  );
  const summaries = entries.filter((entry) => entry.type === "branch_summary");
  harness.assert(summaries.length === 1, `Expected one branch_summary entry, got ${summaries.length}`);
  harness.assert(
    summaries[0]?.summary === `${summaryPrefix}DETERMINISTIC BRANCH SUMMARY`,
    "Persisted branch summary wrapper or generated text changed",
  );
  harness.assert(
    JSON.stringify(summaries[0]?.details) === JSON.stringify({ readFiles: [], modifiedFiles: [] }),
    "Persisted branch summary details changed",
  );

  await fallbackScenario(
    "branch-summary-default-noop",
    undefined,
    "DEFAULT CURRENT SUMMARY",
    false,
  );
  await fallbackScenario(
    "branch-summary-auth-fallback",
    "generated-state-noauth/gemini-noauth",
    "AUTH FALLBACK SUMMARY",
    false,
  );
  await fallbackScenario(
    "branch-summary-error-fallback",
    "generated-state-e2e/gemini-fake",
    "ERROR FALLBACK SUMMARY",
    true,
  );
  await projectPrecedenceScenario();
  await malformedProjectSettingsScenario();
  await abortScenario();
  console.log("PASS branch-summary-model");
} finally {
  await cleanupRun(runDirectory);
}
