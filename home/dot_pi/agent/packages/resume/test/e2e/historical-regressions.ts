import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  cleanupRun,
  makeRunDirectory,
  PiTuiHarness,
} from "../../../../extensions/test/e2e/harness.ts";
import { assert, readJsonLines, timestamp, writeSession } from "./support.ts";

const agentRoot = resolve(import.meta.dir, "../../../..");
const runDirectory = makeRunDirectory(agentRoot);
const extension = "packages/resume";

async function closeSelector(harness: PiTuiHarness): Promise<void> {
  await harness.sendKeys("Escape");
  await harness.waitUntil("resume selector close", async () => {
    const view = await harness.capture();
    return (
      !view.includes("Resume Session (") && !view.includes("Ctrl+R expand")
    );
  });
}

function appendThinkingReply(path: string, id: string): void {
  const at = timestamp(43);
  appendFileSync(
    path,
    `${JSON.stringify({
      type: "message",
      id: `${id}-assistant`,
      parentId: `${id}-name`,
      timestamp: at,
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "E2E_SECRET_THINKING_TRACE" },
          { type: "text", text: "E2E_VISIBLE_ASSISTANT_REPLY" },
        ],
        api: "openai-responses",
        provider: "openai",
        model: "e2e-model",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.parse(at),
      },
    })}\n`,
  );
}

async function hiddenThinkingPreviewScenario(): Promise<void> {
  const sessions = join(runDirectory, "thinking-preview-sessions");
  const current = join(sessions, "current.jsonl");
  const target = join(sessions, "thinking.jsonl");
  writeSession(
    current,
    "71000000-0000-7000-8000-000000000001",
    "Thinking Current",
    ["CURRENT THINKING BODY"],
    1,
  );
  const targetId = "71000000-0000-7000-8000-000000000002";
  writeSession(
    target,
    targetId,
    "Thinking Preview Target",
    ["E2E THINKING USER"],
    20,
  );
  appendThinkingReply(target, targetId);
  const harness = await PiTuiHarness.start({
    name: "resume-thinking-preview",
    root: agentRoot,
    runDirectory,
    persistSession: true,
    cliArguments: ["--session-dir", sessions, "--session", current],
    extensions: [extension],
  });

  try {
    await harness.submitCommand("resume");
    await harness.sendLiteral("Thinking Preview Target");
    await harness.waitFor("Thinking Preview Target");
    await harness.sendKeys("C-r");
    const preview = await harness.waitFor("E2E_VISIBLE_ASSISTANT_REPLY");
    assert(
      !preview.includes("E2E_SECRET_THINKING_TRACE"),
      "Expanded preview exposed an assistant thinking block",
    );
    await harness.sendKeys("C-r");
    await harness.waitFor("Ctrl+R expand");
    await closeSelector(harness);
    await harness.finish();
  } finally {
    await harness.abort().catch(() => undefined);
  }
  console.log("PASS resume expanded preview hides thinking blocks");
}

async function parentAlignedTreeGuideScenario(): Promise<void> {
  const sessions = join(runDirectory, "tree-guide-sessions");
  const current = join(sessions, "current.jsonl");
  const parent = join(sessions, "parent.jsonl");
  const child = join(sessions, "child.jsonl");
  const grandchild = join(sessions, "grandchild.jsonl");
  writeSession(
    current,
    "72000000-0000-7000-8000-000000000001",
    "Tree Current",
    ["CURRENT TREE BODY"],
    1,
  );
  writeSession(
    parent,
    "72000000-0000-7000-8000-000000000002",
    "ParentAlign",
    ["PARENT TREE BODY"],
    20,
  );
  writeSession(
    child,
    "72000000-0000-7000-8000-000000000003",
    "ChildAlign",
    ["CHILD TREE BODY"],
    30,
    parent,
  );
  writeSession(
    grandchild,
    "72000000-0000-7000-8000-000000000004",
    "GrandchildAlign",
    ["GRANDCHILD TREE BODY"],
    40,
    child,
  );
  const harness = await PiTuiHarness.start({
    name: "resume-tree-guides",
    root: agentRoot,
    runDirectory,
    persistSession: true,
    width: 120,
    cliArguments: ["--session-dir", sessions, "--session", current],
    extensions: [extension],
  });

  try {
    await harness.submitCommand("resume");
    const view = await harness.waitFor("GrandchildAlign");
    const lines = view.split("\n");
    const parentLine = lines.find((line) => line.includes("ParentAlign"));
    const childLine = lines.find((line) => line.includes("ChildAlign"));
    const grandchildLine = lines.find((line) =>
      line.includes("GrandchildAlign"),
    );
    assert(
      parentLine && childLine && grandchildLine,
      "Resume tree omitted a seeded hierarchy node",
    );
    const parentColumn = parentLine.indexOf("ParentAlign");
    const childGuideColumn = childLine.indexOf("└─");
    const childTextColumn = childLine.indexOf("ChildAlign");
    const grandchildGuideColumn = grandchildLine.indexOf("└─");
    assert(
      childGuideColumn === parentColumn,
      "First child guide did not start at the parent text column",
    );
    assert(
      grandchildGuideColumn === childTextColumn,
      "Grandchild guide did not start at the direct parent text column",
    );
    await closeSelector(harness);
    await harness.finish();
  } finally {
    await harness.abort().catch(() => undefined);
  }
  console.log("PASS resume tree guides align with each direct parent");
}

async function activeRenameRefreshScenario(): Promise<void> {
  const name = "resume-active-rename";
  const sessions = join(runDirectory, "active-rename-sessions");
  const current = join(sessions, "current.jsonl");
  writeSession(
    current,
    "73000000-0000-7000-8000-000000000001",
    "Rename Active Before",
    ["ACTIVE RENAME BODY"],
    1,
  );
  const stateDirectory = join(runDirectory, `${name}-state`);
  mkdirSync(stateDirectory, { recursive: true });
  writeFileSync(
    join(stateDirectory, "keybindings.json"),
    `${JSON.stringify({ "app.session.rename": "alt+r" }, null, 2)}\n`,
  );
  const harness = await PiTuiHarness.start({
    name,
    root: agentRoot,
    runDirectory,
    persistSession: true,
    cliArguments: ["--session-dir", sessions, "--session", current],
    extensions: [extension],
  });

  try {
    await harness.submitCommand("resume");
    await harness.sendLiteral("Rename Active Before");
    await harness.waitFor("> Rename Active Before");
    await harness.sendLiteral("\u001br");
    await harness.waitFor("Rename Session");
    await harness.sendKeys("C-a", "C-k");
    await harness.sendLiteral("Rename Active After");
    await harness.sendKeys("Enter");
    await harness.waitFor("Rename Active After");
    await closeSelector(harness);
    const activeView = await harness.waitFor("• Rename Active After");
    assert(
      activeView
        .split("\n")
        .some((line) => line.includes("• Rename Active After")),
      "Active rename did not refresh the visible current-session footer",
    );
    assert(
      readJsonLines(current).some(
        (entry) =>
          entry.type === "session_info" && entry.name === "Rename Active After",
      ),
      "Active rename did not persist the new session name",
    );
    await harness.finish();
  } finally {
    await harness.abort().catch(() => undefined);
  }
  console.log("PASS resume active rename refreshes the live session manager");
}

async function newSessionVisibilityScenario(): Promise<void> {
  const sessions = join(runDirectory, "new-session-visibility-sessions");
  const source = join(sessions, "source.jsonl");
  writeSession(
    source,
    "75000000-0000-7000-8000-000000000001",
    "New Session Source",
    ["NEW SESSION SOURCE BODY"],
    1,
  );
  const harness = await PiTuiHarness.start({
    name: "resume-new-session-visibility",
    root: agentRoot,
    runDirectory,
    persistSession: true,
    cliArguments: ["--session-dir", sessions, "--session", source],
    extensions: [extension],
  });

  try {
    await harness.submitCommand("new");
    await harness.waitFor("New session started");
    await harness.submit("/name New Current Session");
    await harness.waitFor("Session name set: New Current Session");

    const openedAt = performance.now();
    await harness.submitCommand("resume");
    let view = "";
    await harness.waitUntil(
      "new current session to appear selected",
      async () => {
        view = await harness.capture();
        return /›\s+New Current Session/.test(view);
      },
      1_000,
    );
    assert(
      performance.now() - openedAt < 1_000,
      "New current session took at least one second to appear selected",
    );
    await closeSelector(harness);
    await harness.finish();
  } finally {
    await harness.abort().catch(() => undefined);
  }
  console.log("PASS resume shows and selects a new session within one second");
}

async function extensionCreatedSessionScenario(
  kind: "branch" | "child",
): Promise<void> {
  const sessions = join(runDirectory, `${kind}-created-session-sessions`);
  const source = join(sessions, "source.jsonl");
  const sourceName =
    kind === "branch" ? "Branch Extension Source" : "Child Extension Source";
  writeSession(
    source,
    kind === "branch"
      ? "76000000-0000-7000-8000-000000000001"
      : "77000000-0000-7000-8000-000000000001",
    sourceName,
    [`${kind.toUpperCase()} EXTENSION SOURCE BODY`],
    1,
  );
  const creatorExtension =
    kind === "branch"
      ? "extensions/branch-merge.ts"
      : "extensions/new-child-split.ts";
  const harness = await PiTuiHarness.start({
    name: `resume-${kind}-created-session`,
    root: agentRoot,
    runDirectory,
    persistSession: true,
    cliArguments: ["--session-dir", sessions, "--session", source],
    extensions: [extension, creatorExtension, "extensions/drop-session.ts"],
  });

  try {
    if (kind === "branch") {
      await harness.submitCommand("branch");
    } else {
      await harness.sendLiteral("/new child");
      await Bun.sleep(150);
      await harness.sendKeys("Escape", "Enter");
    }
    await harness.waitFor(
      kind === "branch" ? "Forked to new session" : "New child session started",
    );

    const openedAt = performance.now();
    await harness.submitCommand("resume");
    let view = "";
    await harness.waitUntil(
      `${kind} session to appear selected on first resume`,
      async () => {
        view = await harness.capture();
        return kind === "branch"
          ? new RegExp(`›[^\\n]*${sourceName}`).test(view)
          : /›[^\n]*\(no messages\)/.test(view);
      },
      1_000,
    );
    assert(
      performance.now() - openedAt < 1_000,
      `${kind} session took at least one second to appear selected`,
    );
    assert(
      !view.includes("No sessions in current folder"),
      `Resume showed an empty catalog for the ${kind} session`,
    );
    await closeSelector(harness);

    await harness.submitCommand("drop");
    await harness.waitFor(`• ${sourceName}`);
    const reopenedAt = performance.now();
    await harness.sendLiteral("/resume");
    await Bun.sleep(150);
    await harness.sendKeys("Escape", "Enter");
    await harness.waitUntil(
      `parent session after dropping ${kind} session`,
      async () =>
        new RegExp(`›[^\\n]*${sourceName}`).test(await harness.capture()),
      1_000,
    );
    assert(
      performance.now() - reopenedAt < 1_000,
      `Replacement session took at least one second after dropping ${kind} session`,
    );
    await closeSelector(harness);
    await harness.finish();
  } finally {
    await harness.abort().catch(() => undefined);
  }
  console.log(
    `PASS resume handles ${kind} extension sessions before and after drop`,
  );
}

async function staleSessionContextScenario(): Promise<void> {
  const sessions = join(runDirectory, "stale-context-sessions");
  const source = join(sessions, "source.jsonl");
  const target = join(sessions, "target.jsonl");
  writeSession(
    source,
    "74000000-0000-7000-8000-000000000001",
    "Stale Context Source",
    ["STALE SOURCE BODY"],
    1,
  );
  writeSession(
    target,
    "74000000-0000-7000-8000-000000000002",
    "Stale Context Target",
    ["STALE TARGET BODY"],
    20,
  );
  const harness = await PiTuiHarness.start({
    name: "resume-stale-context",
    root: agentRoot,
    runDirectory,
    persistSession: true,
    cliArguments: ["--session-dir", sessions, "--session", source],
    extensions: [extension],
  });

  try {
    await harness.submitCommand("new");
    await harness.waitFor("New session started");
    await harness.sendLiteral("/");
    await harness.waitFor(/→\s+settings(?:\s|$)/);
    await harness.sendKeys("C-u");

    await harness.submitCommand("resume");
    await harness.sendLiteral("Stale Context Target");
    await harness.waitFor("Stale Context Target");
    await harness.sendKeys("Enter");
    await harness.waitFor("STALE TARGET BODY");
    await harness.sendLiteral("/");
    await harness.waitFor(/→\s+settings(?:\s|$)/);
    await harness.sendKeys("C-u");

    await harness.submitCommand("resume");
    const reopenedPicker = await harness.capture();
    assert(
      !reopenedPicker.includes("Indexing…"),
      "Resume reindexed after switching sessions",
    );
    await harness.waitFor("Stale Context Target");
    await closeSelector(harness);
    await harness.finish();
    const log = readFileSync(harness.logPath, "utf8");
    assert(
      !/stale session|previous session context/i.test(log),
      "Resume used a replaced session context",
    );
  } finally {
    await harness.abort().catch(() => undefined);
  }
  console.log(
    "PASS resume replaces autocomplete context after /new and session switch",
  );
}

try {
  mkdirSync(runDirectory, { recursive: true });
  await Promise.all([
    hiddenThinkingPreviewScenario(),
    parentAlignedTreeGuideScenario(),
    activeRenameRefreshScenario(),
    newSessionVisibilityScenario(),
    extensionCreatedSessionScenario("branch"),
    extensionCreatedSessionScenario("child"),
    staleSessionContextScenario(),
  ]);
} finally {
  await cleanupRun(runDirectory);
}
