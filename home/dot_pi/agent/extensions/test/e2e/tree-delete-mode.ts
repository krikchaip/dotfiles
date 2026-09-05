import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cleanupRun, makeRunDirectory, PiTuiHarness } from "./harness.ts";

const root = resolve(import.meta.dir, "../../..");
const runDirectory = makeRunDirectory(root);
const capturePath = `${runDirectory}/tree-delete-mode.json`;

async function closeTree(harness: PiTuiHarness): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await harness.sendKeys("Escape");
    await Bun.sleep(250);
    if (!(await harness.capture()).includes("DELETE MODE")) break;
  }
  let stableFrames = 0;
  await harness.waitUntil("session tree delete-mode exit", async () => {
    const exited = !(await harness.capture()).includes("DELETE MODE");
    stableFrames = exited ? stableFrames + 1 : 0;
    return stableFrames >= 2;
  });
  if ((await harness.capture()).includes("Session Tree")) {
    for (let attempt = 0; attempt < 3; attempt++) {
      await harness.sendKeys("Escape");
      await Bun.sleep(250);
      if (!(await harness.capture()).includes("Session Tree")) break;
    }
    stableFrames = 0;
    await harness.waitUntil("session tree close", async () => {
      const closed = !(await harness.capture()).includes("Session Tree");
      stableFrames = closed ? stableFrames + 1 : 0;
      return stableFrames >= 2;
    });
  }
}

const harness = await PiTuiHarness.start({
  name: "tree-delete-mode",
  root,
  runDirectory,
  extensions: [
    "extensions/test/e2e/fixture/tree-delete-mode-probe.ts",
    "extensions/tree-delete-mode.ts",
  ],
  environment: { PI_E2E_TREE_DELETE_CAPTURE: capturePath },
});

try {
  await harness.waitFor("TREE DELETE MODE PROBE READY");
  const result = JSON.parse(readFileSync(capturePath, "utf8"));
  const narrow = result.narrowPlain.join("\n");
  harness.assert(
    narrow.includes("Session Tree — DELETE MODE"),
    "Alt+D did not enter delete mode",
  );
  harness.assert(
    narrow.includes("Delete review"),
    "Delete preview summary missing",
  );
  harness.assert(
    result.previewFirst.join("\n").includes("selected subtree: 3 nod"),
    "Preview subtree count changed before width truncation",
  );
  harness.assert(
    result.narrowWidths.every((width: number) => width <= 32),
    "Narrow render overflowed",
  );
  harness.assert(
    result.cancelBytes === result.expectedBytes,
    "Escape changed session entries",
  );
  harness.assert(
    result.cancelFileBytes === result.cancelInitialFileBytes,
    "Escape changed persisted session bytes",
  );
  harness.assert(
    JSON.stringify(result.previewFirst) ===
      JSON.stringify(result.previewSecond),
    "Repeated preview render duplicated or changed help",
  );

  const keptIds = result.deletedEntries.map(
    (entry: { id: string }) => entry.id,
  );
  const persistedIds = result.deletedFileBytes
    .trim()
    .split("\n")
    .map((line: string) => JSON.parse(line).id);
  harness.assert(
    JSON.stringify(persistedIds) === JSON.stringify(keptIds),
    "Session rewrite differs from in-memory deletion",
  );
  harness.assert(
    keptIds.includes("root") && keptIds.includes("sibling"),
    "Deletion removed kept branch",
  );
  for (const id of ["delete-root", "delete-child", "linked-label"]) {
    harness.assert(!keptIds.includes(id), `Deletion retained ${id}`);
  }
  harness.assert(
    result.deletedLeaf === "root",
    `Active leaf did not move to parent: ${result.deletedLeaf}`,
  );
  harness.assert(
    result.statuses.includes("Deleted 3 tree nodes"),
    "Deletion status count changed",
  );
  harness.assert(
    result.streamingBefore === result.streamingAfter,
    "Streaming guard changed entries",
  );
  harness.assert(
    result.streamingFileBytes === result.streamingInitialFileBytes,
    "Streaming guard changed persisted session bytes",
  );
  harness.assert(
    result.streamingWarnings.includes(
      "Cannot delete tree nodes while streaming",
    ),
    "Streaming guard warning missing",
  );
  await harness.finish();

  const nativeCwd = join(runDirectory, "tree-delete-native-cwd");
  const nativeSessions = join(runDirectory, "tree-delete-native-sessions");
  const nativeSession = join(nativeSessions, "native.jsonl");
  mkdirSync(nativeCwd, { recursive: true });
  mkdirSync(nativeSessions, { recursive: true });
  const nativeEntries = [
    {
      type: "session",
      version: 3,
      id: "77777777-7777-7777-8777-777777777777",
      timestamp: "2025-01-01T00:00:00.000Z",
      cwd: nativeCwd,
    },
    {
      type: "message",
      id: "native-user",
      parentId: null,
      timestamp: "2025-01-01T00:00:01.000Z",
      message: {
        role: "user",
        content: [{ type: "text", text: "NATIVE_KEEP" }],
        timestamp: 1735689601000,
      },
    },
    {
      type: "message",
      id: "native-assistant",
      parentId: "native-user",
      timestamp: "2025-01-01T00:00:02.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "NATIVE_DELETE" }],
        api: "openai-completions",
        provider: "tree-e2e",
        model: "fake",
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: 1735689602000,
      },
    },
  ];
  writeFileSync(
    nativeSession,
    `${nativeEntries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
  );
  const nativeHarness = await PiTuiHarness.start({
    name: "tree-delete-native",
    root,
    runDirectory,
    persistSession: true,
    width: 120,
    cliArguments: ["--session-dir", nativeSessions, "--session", nativeSession],
    extensions: [
      "extensions/test/e2e/fixture/tree-shared-help-consumer.ts",
      "extensions/tree-delete-mode.ts",
    ],
  });
  try {
    const beforeCancel = readFileSync(nativeSession, "utf8");
    await nativeHarness.submitCommand("tree");
    await nativeHarness.waitFor(/(?:alt|option)\+d\s+delete/);
    await nativeHarness.sendLiteral("\x1bd");
    await nativeHarness.waitFor("DELETE MODE");
    await nativeHarness.sendKeys("Escape");
    nativeHarness.assert(
      readFileSync(nativeSession, "utf8") === beforeCancel,
      "Native delete cancel changed session bytes",
    );
    await closeTree(nativeHarness);

    await nativeHarness.submitCommand("tree");
    await nativeHarness.waitFor("Session Tree");
    await nativeHarness.sendLiteral("\x1bd");
    await nativeHarness.waitFor("DELETE MODE");
    await nativeHarness.sendKeys("Enter");
    await nativeHarness.waitFor(/Deleted \d+ tree nodes/);
    const nativeBytes = readFileSync(nativeSession, "utf8");
    nativeHarness.assert(
      nativeBytes.includes("NATIVE_KEEP"),
      "Native deletion removed kept parent",
    );
    nativeHarness.assert(
      !nativeBytes.includes("NATIVE_DELETE"),
      "Native deletion did not rewrite selected leaf",
    );
    await closeTree(nativeHarness);
    await nativeHarness.finish();
  } finally {
    await nativeHarness.abort().catch(() => undefined);
  }

  harness.assert(
    result.failureError.includes("E2E forced rewrite failure"),
    "Rewrite failure was not surfaced",
  );
  harness.assert(
    result.failureFileBytes === result.failureInitialFileBytes,
    "Rewrite failure changed persisted session bytes",
  );
  harness.assert(
    result.failureAfter === result.failureBefore,
    "Rewrite failure did not roll back in-memory entries",
  );
  console.log("PASS tree-delete-mode synthetic and native deletion suite");
} finally {
  await harness.abort().catch(() => undefined);
  await cleanupRun(runDirectory);
}
