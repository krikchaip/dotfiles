import { existsSync, readFileSync } from "node:fs";
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
const provider = "extensions/test/e2e/fixture/generated-state-provider.ts";
const extension = "extensions/auto-rename.ts";

function header(id: string, cwd: string, parentSession?: string) {
  return {
    type: "session",
    version: 3,
    id,
    timestamp: new Date(Date.UTC(2025, 0, 1)).toISOString(),
    cwd,
    ...(parentSession ? { parentSession } : {}),
  };
}

async function manualRecentScenario(): Promise<void> {
  const name = "auto-rename-manual";
  const home = isolatedHome(runDirectory, name);
  const cwd = join(runDirectory, `${name}-cwd`);
  const sessionPath = join(runDirectory, `${name}.jsonl`);
  const base = Date.UTC(2025, 0, 1);
  writeJsonl(sessionPath, [
    header("11111111-1111-7111-8111-111111111111", cwd),
    messageEntry("seed-user", null, "user", "MANUAL SEED OLDEST", base + 1_000),
  ]);
  const capturePath = join(runDirectory, `${name}-captures.json`);
  const statusPath = join(runDirectory, `${name}-status.jsonl`);
  const harness = await PiTuiHarness.start({
    name,
    root,
    runDirectory,
    extensions: [
      provider,
      "extensions/test/e2e/fixture/generated-state-probe.ts",
      extension,
    ],
    model: "generated-state-e2e/gemini-fake",
    cliArguments: ["--session", sessionPath],
    persistSession: true,
    environment: {
      HOME: home,
      PI_E2E_PROVIDER_CAPTURE: capturePath,
      PI_E2E_RENAME_STATUS_CAPTURE: statusPath,
      PI_E2E_RESPONSES: JSON.stringify([
        "MANUAL FIRST ASSISTANT",
        "MANUAL SECOND ASSISTANT",
        "focus",
      ]),
      PI_E2E_RESPONSE_DELAYS_MS: JSON.stringify([0, 0, 1_200]),
    },
  });

  await harness.submit("MANUAL FIRST USER");
  await harness.waitFor("MANUAL FIRST ASSISTANT");
  await harness.submit("MANUAL SECOND USER");
  await harness.waitFor("MANUAL SECOND ASSISTANT");

  await harness.sendLiteral("/rename recent ");
  const completion = await harness.waitFor("Use latest 2 messages");
  harness.assert(
    completion.includes("Use latest 16 messages"),
    "Recent-count completions are incomplete",
  );
  await harness.sendKeys("C-u");
  await submitCommand(harness, "/rename recent 0");
  await harness.waitFor("Usage: /rename [recent [N]|session]");

  await submitCommand(harness, "/rename recent 2");
  await harness.waitFor("Generating session name");
  const visibleRenameStatus = readFileSync(harness.logPath, "utf8");
  harness.assert(
    /\x1b\[38;2;138;190;183m[^\x1b ]+\x1b\[39m/.test(visibleRenameStatus),
    "Visible rename spinner did not use the accent color",
  );
  harness.assert(
    visibleRenameStatus.includes(
      "\x1b[38;2;128;128;128mGenerating session name\x1b[39m",
    ),
    "Visible rename message did not use the thinking-text color",
  );
  harness.assert(
    visibleRenameStatus.includes("\x1b[38;2;102;102;102m · \x1b[39m"),
    "Visible rename separator did not use the dim color",
  );
  harness.assert(
    visibleRenameStatus.includes(
      "\x1b[38;2;255;255;0mgenerated-state-e2e/gemini-fake\x1b[39m",
    ),
    "Visible rename model did not use the warning color",
  );
  await harness.waitFor("Session renamed: Focus");
  await finish(harness);

  const captures = JSON.parse(readFileSync(capturePath, "utf8")) as unknown[];
  const namingRequest = JSON.stringify(captures[2]);
  const statusEvents = readFileSync(statusPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  harness.assert(
    statusEvents.some(
      (event) =>
        event.action === "show" &&
        event.kind === "auto-rename:activity" &&
        JSON.stringify(event.rendered).includes(
          "generated-state-e2e/gemini-fake",
        ),
    ),
    "Rename activity indicator omitted its kind or model text",
  );
  harness.assert(
    statusEvents.some(
      (event) =>
        event.action === "clear" && event.kind === "auto-rename:activity",
    ),
    "Rename activity indicator was not cleared",
  );
  harness.assert(
    namingRequest.includes("MANUAL SECOND USER"),
    "recent 2 omitted latest user message",
  );
  harness.assert(
    namingRequest.includes("MANUAL SECOND ASSISTANT"),
    "recent 2 omitted latest assistant message",
  );
  harness.assert(
    !namingRequest.includes("MANUAL FIRST USER"),
    "recent 2 included an older user message",
  );
  harness.assert(
    !namingRequest.includes("MANUAL SEED OLDEST"),
    "recent 2 included seeded history",
  );

  const entries = readEntries(sessionPath);
  harness.assert(
    entries.filter((entry) => entry.type === "message").length === 5,
    "Manual JSONL message count changed",
  );
  const names = entries.filter((entry) => entry.type === "session_info");
  harness.assert(
    names.length === 1 && names[0]?.name === "Focus",
    "One-word manual name was not persisted exactly",
  );
  console.log("PASS auto-rename manual-recent-short-name");
}

async function staleChoiceScenario(): Promise<void> {
  const name = "auto-rename-stale-choice";
  const home = isolatedHome(runDirectory, name);
  const capturePath = join(runDirectory, `${name}-captures.json`);
  const harness = await PiTuiHarness.start({
    name,
    root,
    runDirectory,
    extensions: [
      provider,
      "extensions/test/e2e/fixture/generated-state-probe.ts",
      extension,
    ],
    model: "generated-state-e2e/gemini-fake",
    persistSession: true,
    environment: {
      HOME: home,
      PI_E2E_PROVIDER_CAPTURE: capturePath,
      PI_E2E_RESPONSES: JSON.stringify([
        "STALE CHOICE ASSISTANT",
        "Generated stale choice",
      ]),
      PI_E2E_RESPONSE_DELAYS_MS: JSON.stringify([0, 1_200]),
      PI_E2E_GENERATED_SET_NAME_DURING_INDEX: "1",
      PI_E2E_GENERATED_SET_NAME_DURING_VALUE: "User Choice Wins",
    },
  });

  await harness.submit("STALE CHOICE USER");
  await harness.waitFor("STALE CHOICE ASSISTANT");
  await harness.waitUntil("delayed naming request", () => {
    if (!existsSync(capturePath)) return false;
    return (
      (JSON.parse(readFileSync(capturePath, "utf8")) as unknown[]).length === 2
    );
  });
  await harness.waitUntil("newer name choice during generation", () => {
    const files = sessionFiles(harness);
    return (
      files.length === 1 &&
      readEntries(files[0]!).some(
        (entry) =>
          entry.type === "session_info" && entry.name === "User Choice Wins",
      )
    );
  });
  await Bun.sleep(800);
  await finish(harness);

  const names = readEntries(sessionFiles(harness)[0]!).filter(
    (entry) => entry.type === "session_info",
  );
  harness.assert(
    names.length === 1 && names[0]?.name === "User Choice Wins",
    "Delayed auto-rename overwrote the newer user choice",
  );
  console.log("PASS auto-rename stale-choice");
}

async function failureScenario(): Promise<void> {
  const name = "auto-rename-failure";
  const home = isolatedHome(runDirectory, name);
  const capturePath = join(runDirectory, `${name}-captures.json`);
  const statusPath = join(runDirectory, `${name}-status.jsonl`);
  const harness = await PiTuiHarness.start({
    name,
    root,
    runDirectory,
    extensions: [
      provider,
      "extensions/test/e2e/fixture/generated-state-probe.ts",
      extension,
    ],
    model: "generated-state-e2e/gemini-fake",
    persistSession: true,
    environment: {
      HOME: home,
      PI_E2E_PROVIDER_CAPTURE: capturePath,
      PI_E2E_RENAME_STATUS_CAPTURE: statusPath,
      PI_E2E_RESPONSES: JSON.stringify([
        "RENAME FAILURE ASSISTANT",
        "RENAME FAILURE",
      ]),
      PI_E2E_GENERATED_ERROR_INDEXES: JSON.stringify([1]),
    },
  });

  await harness.submit("RENAME FAILURE USER");
  await harness.waitFor("RENAME FAILURE ASSISTANT");
  await harness.waitUntil("failed naming call", () => {
    if (!existsSync(capturePath)) return false;
    return (
      (JSON.parse(readFileSync(capturePath, "utf8")) as unknown[]).length === 2
    );
  });
  await Bun.sleep(300);
  await finish(harness);
  harness.assert(
    readEntries(sessionFiles(harness)[0]!).every(
      (entry) => entry.type !== "session_info",
    ),
    "Failed auto-rename persisted a session name",
  );
  const statuses = readFileSync(statusPath, "utf8");
  harness.assert(
    statuses.includes('"action":"clear"'),
    "Failed auto-rename left its activity status active",
  );
  console.log("PASS auto-rename failure-cleanup");
}

async function disabledEligibilityScenario(): Promise<void> {
  const name = "auto-rename-disabled";
  const home = isolatedHome(runDirectory, name);
  writeHomeSettings(home, { autoRename: { enabled: false } });
  const capturePath = join(runDirectory, `${name}-captures.json`);
  const harness = await PiTuiHarness.start({
    name,
    root,
    runDirectory,
    extensions: [provider, extension],
    model: "generated-state-e2e/gemini-fake",
    persistSession: true,
    environment: {
      HOME: home,
      PI_E2E_PROVIDER_CAPTURE: capturePath,
      PI_E2E_RESPONSES: JSON.stringify(["RENAME DISABLED ASSISTANT"]),
    },
  });
  await harness.submit("RENAME DISABLED USER");
  await harness.waitFor("RENAME DISABLED ASSISTANT");
  await Bun.sleep(400);
  await finish(harness);
  harness.assert(
    (JSON.parse(readFileSync(capturePath, "utf8")) as unknown[]).length === 1,
    "Disabled auto-rename made a naming request",
  );
  harness.assert(
    readEntries(sessionFiles(harness)[0]!).every(
      (entry) => entry.type !== "session_info",
    ),
    "Disabled auto-rename persisted a name",
  );
  console.log("PASS auto-rename disabled-eligibility");
}

async function ordinaryAutoScenario(): Promise<void> {
  const name = "auto-rename-ordinary";
  const home = isolatedHome(runDirectory, name);
  const capturePath = join(runDirectory, `${name}-captures.json`);
  const harness = await PiTuiHarness.start({
    name,
    root,
    runDirectory,
    extensions: [provider, extension],
    model: "generated-state-e2e/gemini-fake",
    persistSession: true,
    environment: {
      HOME: home,
      PI_E2E_PROVIDER_CAPTURE: capturePath,
      PI_E2E_RESPONSES: JSON.stringify(["ORDINARY ASSISTANT", "tiny"]),
    },
  });
  await harness.submit("ORDINARY FIRST USER");
  await harness.waitFor("ORDINARY ASSISTANT");
  await harness.waitUntil("ordinary auto name persistence", () => {
    const files = sessionFiles(harness);
    if (files.length !== 1) return false;
    return readEntries(files[0]!).some(
      (entry) => entry.type === "session_info" && entry.name === "Tiny",
    );
  });
  await finish(harness);

  const entries = readEntries(sessionFiles(harness)[0]!);
  harness.assert(
    entries.filter((entry) => entry.type === "message").length === 2,
    "Ordinary auto JSONL does not have one turn",
  );
  harness.assert(
    entries.filter((entry) => entry.type === "session_info").length === 1,
    "Ordinary auto rename ran more than once",
  );
  console.log("PASS auto-rename ordinary-auto");
}

async function inheritedChildScenario(): Promise<void> {
  const name = "auto-rename-child";
  const home = isolatedHome(runDirectory, name);
  const cwd = join(runDirectory, `${name}-cwd`);
  const parentPath = join(runDirectory, `${name}-parent.jsonl`);
  const childPath = join(runDirectory, `${name}-child.jsonl`);
  const base = Date.UTC(2025, 0, 1);
  const inherited = [
    messageEntry(
      "parent-user",
      null,
      "user",
      "PARENT TOPIC MUST BE EXCLUDED",
      base + 1_000,
    ),
    messageEntry(
      "parent-assistant",
      "parent-user",
      "assistant",
      "PARENT ANSWER MUST BE EXCLUDED",
      base + 2_000,
    ),
    {
      type: "session_info",
      id: "parent-name",
      parentId: "parent-assistant",
      timestamp: new Date(base + 3_000).toISOString(),
      name: "Inherited Parent Name",
    },
  ];
  const parentRaw = writeJsonl(parentPath, [
    header("22222222-2222-7222-8222-222222222222", cwd),
    ...inherited,
  ]);
  writeJsonl(childPath, [
    header("33333333-3333-7333-8333-333333333333", cwd, parentPath),
    ...inherited,
  ]);
  const capturePath = join(runDirectory, `${name}-captures.json`);
  const harness = await PiTuiHarness.start({
    name,
    root,
    runDirectory,
    extensions: [provider, extension],
    model: "generated-state-e2e/gemini-fake",
    cliArguments: ["--session", childPath],
    persistSession: true,
    environment: {
      HOME: home,
      PI_E2E_PROVIDER_CAPTURE: capturePath,
      PI_E2E_RESPONSES: JSON.stringify(["CHILD ASSISTANT ONLY", "child focus"]),
    },
  });

  await harness.submit("CHILD USER ONLY");
  await harness.waitFor("CHILD ASSISTANT ONLY");
  await harness.waitUntil("child auto name persistence", () =>
    readEntries(childPath).some(
      (entry) => entry.type === "session_info" && entry.name === "Child focus",
    ),
  );
  await finish(harness);

  const captures = JSON.parse(readFileSync(capturePath, "utf8")) as unknown[];
  harness.assert(
    captures.length === 2,
    `Expected child turn and naming calls, got ${captures.length}`,
  );
  const namingRequest = JSON.stringify(captures[1]);
  harness.assert(
    namingRequest.includes("CHILD USER ONLY") &&
      namingRequest.includes("CHILD ASSISTANT ONLY"),
    "Child naming request omitted child dialogue",
  );
  harness.assert(
    !namingRequest.includes("PARENT TOPIC MUST BE EXCLUDED"),
    "Child naming request included parent user dialogue",
  );
  harness.assert(
    !namingRequest.includes("PARENT ANSWER MUST BE EXCLUDED"),
    "Child naming request included parent assistant dialogue",
  );
  harness.assert(
    readFileSync(parentPath, "utf8") === parentRaw,
    "Child rename changed parent JSONL",
  );

  const entries = readEntries(childPath);
  harness.assert(
    entries.filter((entry) => entry.type === "message").length === 4,
    "Child JSONL message sequence changed",
  );
  const names = entries.filter((entry) => entry.type === "session_info");
  harness.assert(
    names.length === 2 &&
      names[0]?.name === "Inherited Parent Name" &&
      names[1]?.name === "Child focus",
    "Child JSONL did not retain inherited and generated names",
  );
  console.log("PASS auto-rename inherited-child");
}

try {
  await manualRecentScenario();
  await staleChoiceScenario();
  await failureScenario();
  await disabledEligibilityScenario();
  await ordinaryAutoScenario();
  await inheritedChildScenario();
  console.log("PASS auto-rename");
} finally {
  await cleanupRun(runDirectory);
}
