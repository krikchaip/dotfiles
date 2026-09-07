import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  cleanupRun,
  makeRunDirectory,
  PiTuiHarness,
} from "../../../../extensions/test/e2e/harness.ts";
import { assert, timestamp, writeSession } from "./support.ts";

const agentRoot = resolve(import.meta.dir, "../../../..");
const runDirectory = makeRunDirectory(agentRoot);
const extension = process.env.RESUME_E2E_EXTENSION ?? "packages/resume";

function writeEmptySession(
  path: string,
  id: string,
  second: number,
  hiddenStartupMessage = false,
): void {
  mkdirSync(dirname(path), { recursive: true });
  const header = JSON.stringify({
    type: "session",
    version: 3,
    id,
    timestamp: timestamp(second),
    cwd: runDirectory,
  });
  const hiddenMessage = hiddenStartupMessage
    ? JSON.stringify({
        type: "custom_message",
        customType: "hidden-startup-rules",
        content: "Injected startup rules",
        display: false,
        id: "hidden-startup-rules",
        parentId: null,
        timestamp: timestamp(second + 1),
      })
    : undefined;
  writeFileSync(path, `${[header, hiddenMessage].filter(Boolean).join("\n")}\n`);
}

async function emptySessionVisibilityScenario(): Promise<void> {
  const sessions = join(runDirectory, "reported-empty-sessions");
  const current = join(sessions, "current-empty.jsonl");
  const otherEmpty = join(sessions, "other-empty.jsonl");
  const metadataOnly = join(sessions, "metadata-only.jsonl");
  const conversation = join(sessions, "conversation.jsonl");

  writeEmptySession(
    current,
    "71000000-0000-7000-8000-000000000001",
    40,
    true,
  );
  writeEmptySession(
    otherEmpty,
    "71000000-0000-7000-8000-000000000002",
    35,
  );
  writeSession(
    metadataOnly,
    "71000000-0000-7000-8000-000000000003",
    "Metadata Only",
    [],
    30,
  );
  writeSession(
    conversation,
    "71000000-0000-7000-8000-000000000004",
    "Conversation Session",
    ["CONVERSATION BODY"],
    20,
  );

  const harness = await PiTuiHarness.start({
    name: "reported-resume-empty",
    root: agentRoot,
    runDirectory,
    persistSession: true,
    cliArguments: ["--session-dir", sessions, "--session", current],
    extensions: [extension],
  });

  try {
    await harness.submitCommand("resume");
    let view = "";
    await harness.waitUntil("exact non-empty resume rows", async () => {
      view = await harness.capture();
      return (
        view.includes("Metadata Only") &&
        view.includes("Conversation Session") &&
        view.includes("Ctrl+R expand")
      );
    });
    assert(
      !view.includes("(no messages)"),
      `Header-only sessions remained visible in /resume\n\nPane:\n${view}`,
    );
    assert(
      /›\s+Metadata Only/.test(view),
      "The first visible row was not selected when the active session was empty",
    );
    await harness.sendKeys("Escape");
    await harness.finish();
  } finally {
    await harness.abort().catch(() => undefined);
  }
}

async function activeChildDeleteScenario(): Promise<void> {
  const sessions = join(runDirectory, "reported-parent-delete-sessions");
  const parent = join(sessions, "parent.jsonl");
  const child = join(sessions, "child.jsonl");
  const unrelated = join(sessions, "unrelated.jsonl");

  writeSession(
    parent,
    "72000000-0000-7000-8000-000000000001",
    "Needle Parent",
    ["PARENT SESSION BODY"],
    10,
  );
  writeSession(
    child,
    "72000000-0000-7000-8000-000000000002",
    "Needle Child",
    ["CHILD SESSION BODY"],
    30,
    parent,
  );
  writeSession(
    unrelated,
    "72000000-0000-7000-8000-000000000003",
    "Unrelated Session",
    ["UNRELATED SESSION BODY"],
    20,
  );

  const harness = await PiTuiHarness.start({
    name: "reported-resume-parent-delete",
    root: agentRoot,
    runDirectory,
    persistSession: true,
    cliArguments: ["--session-dir", sessions, "--session", child],
    extensions: [extension],
  });

  try {
    await harness.submitCommand("resume");
    await harness.waitFor("Needle Child");
    await harness.sendKeys("Tab");
    await harness.waitFor("◉ All");
    await harness.sendKeys("C-s");
    await harness.waitFor("Sort: Recent");
    await harness.sendKeys("C-n");
    await harness.waitFor("Name: Named");
    await harness.sendLiteral("Needle");
    await harness.waitUntil("active child search result", async () =>
      /›\s+Needle Child/.test(await harness.capture()),
    );
    await harness.sendKeys("C-p");
    await harness.waitFor("path (on)");
    await harness.sendKeys("C-d");
    await harness.waitFor("Delete session?");
    await harness.sendKeys("Enter");
    await harness.waitUntil("active child deletion", () => !existsSync(child));

    let view = "";
    await harness.waitUntil("parent selected in preserved picker", async () => {
      view = await harness.capture();
      return (
        view.includes("Resume Session") && /›\s+Needle Pa/.test(view)
      );
    });
    assert(existsSync(parent), "Active child deletion removed its parent");
    assert(
      /^> Needle\s*$/m.test(view),
      `Active deletion did not preserve the picker search\n\nPane:\n${view}`,
    );
    assert(
      view.includes("◉ All") &&
        view.includes("Sort: Recent") &&
        view.includes("Name: Named") &&
        view.includes("path (on)"),
      `Active deletion did not preserve picker modes\n\nPane:\n${view}`,
    );
    assert(
      !view.includes("Needle Child"),
      `Deleted child remained visible in the picker\n\nPane:\n${view}`,
    );

    await harness.sendKeys("Escape");
    await harness.waitFor("PARENT SESSION BODY");
    await harness.finish();
  } finally {
    await harness.abort().catch(() => undefined);
  }
}

const selectedScenario = process.argv[2];

try {
  mkdirSync(runDirectory, { recursive: true });
  if (!selectedScenario || selectedScenario === "empty") {
    await emptySessionVisibilityScenario();
  }
  if (!selectedScenario || selectedScenario === "parent-delete") {
    await activeChildDeleteScenario();
  }
  console.log("PASS reported /resume regressions");
} finally {
  await cleanupRun(runDirectory);
}
