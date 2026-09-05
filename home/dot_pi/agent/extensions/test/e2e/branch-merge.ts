import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cleanupRun, makeRunDirectory, PiTuiHarness } from "./harness.ts";

const root = resolve(import.meta.dir, "../../..");
const runDirectory = makeRunDirectory(root);
const sessions = join(runDirectory, "sessions");
mkdirSync(sessions, { recursive: true });
const sourcePath = join(sessions, "source.jsonl");
const targetPath = join(sessions, "target.jsonl");
const capturePath = join(runDirectory, "branch-merge-provider.jsonl");
const SOURCE_ID = "11111111-1111-7111-8111-111111111111";
const TARGET_ID = "22222222-2222-7222-8222-222222222222";
const at = (second: number) =>
  new Date(Date.UTC(2025, 0, 1, 0, 0, second)).toISOString();
const user = (text: string) => ({
  role: "user",
  content: [{ type: "text", text }],
  timestamp: 1,
});
const assistant = (text: string) => ({
  role: "assistant",
  content: [{ type: "text", text }],
  api: "openai-completions",
  provider: "branch-merge-e2e",
  model: "fake",
  stopReason: "stop",
  timestamp: 1,
  usage: {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
});
function writeJsonl(path: string, entries: unknown[]) {
  writeFileSync(
    path,
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
  );
}
function seed() {
  writeJsonl(targetPath, [
    {
      type: "session",
      version: 3,
      id: TARGET_ID,
      timestamp: at(0),
      cwd: runDirectory,
    },
    {
      type: "message",
      id: "shared-u",
      parentId: null,
      timestamp: at(1),
      message: user("TARGET_KNOWN"),
    },
    {
      type: "session_info",
      id: "target-name",
      parentId: "shared-u",
      timestamp: at(2),
      name: "Target Main",
    },
  ]);
  writeJsonl(sourcePath, [
    {
      type: "session",
      version: 3,
      id: SOURCE_ID,
      timestamp: at(0),
      cwd: runDirectory,
      parentSession: targetPath,
    },
    {
      type: "message",
      id: "old-u",
      parentId: null,
      timestamp: at(1),
      message: user("OLD_RAW_BEFORE_COMPACTION"),
    },
    {
      type: "message",
      id: "old-a",
      parentId: "old-u",
      timestamp: at(2),
      message: assistant("OLD_ASSISTANT"),
    },
    {
      type: "compaction",
      id: "compact-1",
      parentId: "old-a",
      timestamp: at(3),
      summary: "BASELINE_COMPACTION",
      firstKeptEntryId: "shared-u",
      tokensBefore: 100,
    },
    {
      type: "message",
      id: "shared-u",
      parentId: "compact-1",
      timestamp: at(4),
      message: user("TARGET_KNOWN"),
    },
    {
      type: "branch_summary",
      id: "echo-1",
      parentId: "shared-u",
      timestamp: at(5),
      summary: "TARGET_ECHO_MUST_NOT_RETURN",
      fromId: "shared-u",
      details: {
        sourceSessionId: TARGET_ID,
        branchMergeSourceEntryIds: ["shared-u"],
      },
    },
    {
      type: "message",
      id: "new-u",
      parentId: "echo-1",
      timestamp: at(6),
      message: user("NEW_DELTA_USER"),
    },
    {
      type: "message",
      id: "new-a",
      parentId: "new-u",
      timestamp: at(7),
      message: assistant("NEW_DELTA_ASSISTANT"),
    },
    {
      type: "session_info",
      id: "source-name",
      parentId: "new-a",
      timestamp: at(8),
      name: "Source Feature",
    },
  ]);
}

seed();
const harness = await PiTuiHarness.start({
  name: "branch-merge",
  root,
  runDirectory,
  persistSession: true,
  cliArguments: ["--session-dir", sessions, "--session", sourcePath],
  model: "branch-merge-e2e/fake",
  extensions: [
    "extensions/branch-merge.ts",
    "extensions/test/e2e/fixture/branch-merge-provider.ts",
  ],
  environment: {
    PI_E2E_BRANCH_MERGE_CAPTURE: capturePath,
    HOME: join(runDirectory, "home"),
  },
});

async function submitCommand(active: PiTuiHarness, text: string) {
  await active.sendLiteral(text);
  await Bun.sleep(150);
  await active.sendKeys("Escape", "Enter");
}

try {
  await submitCommand(
    harness,
    `/merge ${TARGET_ID.slice(0, 8)} preserve exact baseline`,
  );
  const postMergePicker = await harness.waitFor(
    "Merge complete. Select next action:",
    15_000,
  );
  const pickerLines = postMergePicker.split("\n");
  harness.assert(
    pickerLines.some((line) =>
      line.startsWith("  Merge complete. Select next action:"),
    ),
    "Post-merge picker title lost its two-cell indent",
  );
  harness.assert(
    pickerLines.some((line) => /^  →\s+\d\)/.test(line)),
    "Post-merge picker selected row lost its two-cell indent",
  );
  harness.assert(
    pickerLines.some((line) => line.startsWith("  ↑↓ navigate")),
    "Post-merge picker help lost its two-cell indent",
  );
  harness.assert(
    pickerLines.some((line) => line.startsWith("  Target ")),
    "Post-merge picker session details lost their two-cell indent",
  );
  await harness.sendKeys("Escape");
  await harness.waitFor("Merged into target session");

  const targetAfter = readFileSync(targetPath, "utf8");
  const targetEntries = targetAfter
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const summaries = targetEntries.filter(
    (entry) => entry.type === "branch_summary",
  );
  const labels = targetEntries.filter((entry) => entry.type === "label");
  harness.assert(
    summaries.length === 1,
    `Expected one persisted summary, got ${summaries.length}`,
  );
  harness.assert(
    labels.length === 1,
    `Expected one persisted label, got ${labels.length}`,
  );
  harness.assert(
    summaries[0].summary.includes("Merged exact goal"),
    "Generated summary changed",
  );
  harness.assert(
    summaries[0].summary.includes(`Merged from session ${SOURCE_ID}`),
    "Source provenance missing",
  );
  harness.assert(
    summaries[0].details.instruction === "preserve exact baseline",
    "Instruction metadata missing",
  );
  harness.assert(
    labels[0].label === "Source Feature",
    `Unexpected summary label: ${labels[0].label}`,
  );
  harness.assert(
    labels[0].targetId === summaries[0].id,
    "Label does not target merge summary",
  );

  const providerContext = readFileSync(capturePath, "utf8");
  harness.assert(
    providerContext.includes("BASELINE_COMPACTION"),
    "Compaction baseline omitted from generation",
  );
  harness.assert(
    providerContext.includes("NEW_DELTA_USER"),
    "New user delta omitted",
  );
  harness.assert(
    providerContext.includes("NEW_DELTA_ASSISTANT"),
    "New assistant delta omitted",
  );
  harness.assert(
    !providerContext.includes("OLD_RAW_BEFORE_COMPACTION"),
    "Compacted raw history replayed",
  );
  harness.assert(
    !providerContext.includes("TARGET_ECHO_MUST_NOT_RETURN"),
    "Target merge echo replayed",
  );

  await submitCommand(harness, `/merge ${TARGET_ID.slice(0, 8)}`);
  await harness.waitFor("Nothing new to merge");
  harness.assert(
    readFileSync(targetPath, "utf8") === targetAfter,
    "No-op second merge changed target",
  );

  for (const { flag, key } of [
    { flag: "--sp", key: "C-M-s" },
    { flag: "--vsp", key: "C-M-v" },
    { flag: "--win", key: "C-M-w" },
  ]) {
    const socket = join(runDirectory, "branch-merge.tmux.sock");
    const sourceWindow = Number(
      (
        await Bun.$`tmux -S ${socket} display-message -p -t ${harness.paneId} '#{window_index}'`.text()
      ).trim(),
    );
    const windowsBefore = Number(
      (await Bun.$`tmux -S ${socket} list-windows | wc -l`.text()).trim(),
    );
    await harness.sendKeys(key);
    await Bun.sleep(700);
    const ids = (
      await Bun.$`tmux -S ${socket} list-panes -a -F '#{pane_id}'`.text()
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    const childId = ids.find((id) => id !== harness.paneId);
    harness.assert(childId, `${flag} did not create a tmux target`);
    if (flag === "--win") {
      const windows = Number(
        (await Bun.$`tmux -S ${socket} list-windows | wc -l`.text()).trim(),
      );
      const childWindow = Number(
        (
          await Bun.$`tmux -S ${socket} display-message -p -t ${childId!} '#{window_index}'`.text()
        ).trim(),
      );
      harness.assert(
        windows > windowsBefore,
        "--win did not create a tmux window",
      );
      harness.assert(
        childWindow === sourceWindow + 1,
        `--win opened at index ${childWindow}, expected ${sourceWindow + 1}`,
      );
    } else {
      const sourceSize = (
        await Bun.$`tmux -S ${socket} display-message -p -t ${harness.paneId} '#{pane_width} #{pane_height}'`.text()
      )
        .trim()
        .split(" ")
        .map(Number);
      const childSize = (
        await Bun.$`tmux -S ${socket} display-message -p -t ${childId!} '#{pane_width} #{pane_height}'`.text()
      )
        .trim()
        .split(" ")
        .map(Number);
      harness.assert(
        flag === "--sp"
          ? sourceSize[0] === childSize[0]
          : sourceSize[1] === childSize[1],
        `${flag} used the wrong split orientation`,
      );
    }
    await Bun.$`tmux -S ${socket} kill-pane -t ${childId!}`.quiet().nothrow();
  }

  const sessionCountBeforeShortcut = [
    ...new Bun.Glob("*.jsonl").scanSync(sessions),
  ].length;
  await harness.sendKeys("C-M-b");
  await harness.waitFor("Cloned to new session", 8_000);
  await harness.waitUntil(
    "same-pane branch shortcut session",
    () =>
      [...new Bun.Glob("*.jsonl").scanSync(sessions)].length ===
      sessionCountBeforeShortcut + 1,
  );

  await harness.finish();

  seed();
  const targetBeforeCancel = readFileSync(targetPath, "utf8");
  const cancelHarness = await PiTuiHarness.start({
    name: "branch-merge-cancel",
    root,
    runDirectory,
    persistSession: true,
    cliArguments: ["--session-dir", sessions, "--session", sourcePath],
    model: "branch-merge-e2e/fake",
    extensions: [
      "extensions/branch-merge.ts",
      "extensions/test/e2e/fixture/branch-merge-provider.ts",
    ],
    environment: {
      PI_E2E_BRANCH_MERGE_CAPTURE: capturePath,
      PI_E2E_BRANCH_MERGE_DELAY: "1",
      HOME: join(runDirectory, "cancel-home"),
    },
  });
  try {
    await submitCommand(
      cancelHarness,
      `/merge ${TARGET_ID.slice(0, 8)} cancel this`,
    );
    await cancelHarness.waitFor("Merge context into", 8_000);
    const observedFrames = new Set<string>();
    for (let sample = 0; sample < 4; sample++) {
      const pane = await cancelHarness.capture();
      const mergeLines = pane
        .split("\n")
        .filter((line) => line.includes("Merge context into"));
      cancelHarness.assert(
        mergeLines.length === 1,
        `Merge loader clashed with another merge spinner: ${mergeLines.length} lines`,
      );
      const match = mergeLines[0]!.match(/^ ([·✢✳✶✻✽]) Merge context into/);
      cancelHarness.assert(
        match,
        `Merge spinner lost one-cell padding: ${mergeLines[0]}`,
      );
      observedFrames.add(match![1]!);
      await Bun.sleep(280);
    }
    cancelHarness.assert(
      observedFrames.size >= 2,
      `Merge spinner did not animate through non-clashing frames: ${[...observedFrames].join("")}`,
    );
    await cancelHarness.sendKeys("Escape");
    await cancelHarness.waitFor(
      "Merge cancelled; target session unchanged",
      8_000,
    );
    cancelHarness.assert(
      readFileSync(targetPath, "utf8") === targetBeforeCancel,
      "Cancelled merge changed target bytes",
    );
    await cancelHarness.finish();
  } finally {
    await cancelHarness.abort().catch(() => undefined);
  }
  let pairCounter = 0;
  const createPair = (
    name: string,
    options: { parent?: boolean; sourceName?: boolean } = {},
  ) => {
    const source = join(sessions, `${name}-source.jsonl`);
    const target = join(sessions, `${name}-target.jsonl`);
    pairCounter++;
    const sourcePrefix = (0xabc00000 + pairCounter * 2).toString(16);
    const targetPrefix = (0xabc00001 + pairCounter * 2).toString(16);
    const sourceId = `${sourcePrefix}-1111-7111-8111-111111111111`;
    const targetId = `${targetPrefix}-2222-7222-8222-222222222222`;
    writeJsonl(target, [
      {
        type: "session",
        version: 3,
        id: targetId,
        timestamp: at(10),
        cwd: runDirectory,
      },
      {
        type: "message",
        id: `${name}-target-user`,
        parentId: null,
        timestamp: at(11),
        message: user(`${name} TARGET`),
      },
      {
        type: "session_info",
        id: `${name}-target-name`,
        parentId: `${name}-target-user`,
        timestamp: at(12),
        name: `${name} Target`,
      },
    ]);
    writeJsonl(source, [
      {
        type: "session",
        version: 3,
        id: sourceId,
        timestamp: at(10),
        cwd: runDirectory,
        ...(options.parent === false ? {} : { parentSession: target }),
      },
      {
        type: "message",
        id: `${name}-source-user`,
        parentId: null,
        timestamp: at(11),
        message: user(`${name} SOURCE DELTA`),
      },
      {
        type: "message",
        id: `${name}-source-assistant`,
        parentId: `${name}-source-user`,
        timestamp: at(12),
        message: assistant(`${name} SOURCE RESULT`),
      },
      ...(options.sourceName === false
        ? []
        : [
            {
              type: "session_info",
              id: `${name}-source-name`,
              parentId: `${name}-source-assistant`,
              timestamp: at(13),
              name: `${name} Source`,
            },
          ]),
    ]);
    return { source, target, sourceId, targetId };
  };

  const pullPair = createPair("pulldemo");
  const pullHarness = await PiTuiHarness.start({
    name: "branch-pull",
    root,
    runDirectory,
    persistSession: true,
    cliArguments: ["--session-dir", sessions, "--session", pullPair.target],
    model: "branch-merge-e2e/fake",
    extensions: [
      "extensions/branch-merge.ts",
      "extensions/test/e2e/fixture/branch-merge-provider.ts",
    ],
    environment: {
      PI_E2E_BRANCH_MERGE_CAPTURE: join(runDirectory, "pull-capture.jsonl"),
    },
  });
  try {
    await submitCommand(
      pullHarness,
      `/pull ${pullPair.sourceId.slice(0, 8)} preserve pull delta`,
    );
    await pullHarness.waitUntil(
      "persisted /pull summary",
      () =>
        readFileSync(pullPair.target, "utf8").includes(
          '"type":"branch_summary"',
        ),
      15_000,
    );
    const afterPull = readFileSync(pullPair.target, "utf8");
    const pullEntries = afterPull
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const pullSummary = pullEntries.find(
      (entry) => entry.type === "branch_summary",
    );
    pullHarness.assert(pullSummary, "/pull did not persist a summary");
    pullHarness.assert(
      pullSummary.details.instruction === "preserve pull delta",
      "/pull lost instruction metadata",
    );
    pullHarness.assert(
      pullSummary.details.sourceSessionId === pullPair.sourceId,
      "/pull lost source provenance",
    );
    await submitCommand(pullHarness, `/pull ${pullPair.sourceId.slice(0, 8)}`);
    await pullHarness.waitFor("Nothing new to merge");
    pullHarness.assert(
      readFileSync(pullPair.target, "utf8") === afterPull,
      "No-op /pull changed target bytes",
    );
    await pullHarness.finish();
  } finally {
    await pullHarness.abort().catch(() => undefined);
  }

  const pullCancelPair = createPair("pullstop");
  const pullCancelHarness = await PiTuiHarness.start({
    name: "branch-pull-cancel",
    root,
    runDirectory,
    persistSession: true,
    cliArguments: [
      "--session-dir",
      sessions,
      "--session",
      pullCancelPair.target,
    ],
    model: "branch-merge-e2e/fake",
    extensions: [
      "extensions/branch-merge.ts",
      "extensions/test/e2e/fixture/branch-merge-provider.ts",
    ],
    environment: { PI_E2E_BRANCH_MERGE_DELAY: "1" },
  });
  try {
    const pullBeforeCancel = readFileSync(pullCancelPair.target, "utf8");
    await submitCommand(
      pullCancelHarness,
      `/pull ${pullCancelPair.sourceId.slice(0, 8)}`,
    );
    await pullCancelHarness.waitFor("Pulling context from", 8_000);
    await pullCancelHarness.sendKeys("Escape");
    await pullCancelHarness.waitFor(
      "Pull cancelled; current session unchanged",
      8_000,
    );
    pullCancelHarness.assert(
      readFileSync(pullCancelPair.target, "utf8") === pullBeforeCancel,
      "Cancelled /pull changed target bytes",
    );
    await pullCancelHarness.finish();
  } finally {
    await pullCancelHarness.abort().catch(() => undefined);
  }

  for (const side of ["source", "target"] as const) {
    const pair = createPair(`mut${side}`);
    const mutatePath = pair[side];
    const mutationHarness = await PiTuiHarness.start({
      name: `branch-mutate-${side}`,
      root,
      runDirectory,
      persistSession: true,
      cliArguments: ["--session-dir", sessions, "--session", pair.source],
      model: "branch-merge-e2e/fake",
      extensions: [
        "extensions/branch-merge.ts",
        "extensions/test/e2e/fixture/branch-merge-provider.ts",
      ],
      environment: {
        PI_E2E_BRANCH_MERGE_MUTATE_PATH: mutatePath,
        PI_E2E_BRANCH_MERGE_MUTATE_MARKER: join(
          runDirectory,
          `mutated-${side}`,
        ),
      },
    });
    try {
      await submitCommand(
        mutationHarness,
        `/merge ${pair.targetId.slice(0, 8)}`,
      );
      await mutationHarness.waitFor(
        side === "source"
          ? "Source session changed during merge"
          : "Target session changed during merge",
        15_000,
      );
      const targetText = readFileSync(pair.target, "utf8");
      mutationHarness.assert(
        !targetText.includes('"type":"branch_summary"'),
        `${side} mutation allowed a partial merge write`,
      );
      await mutationHarness.finish();
    } finally {
      await mutationHarness.abort().catch(() => undefined);
    }
  }

  const labelPair = createPair("labelfail", { sourceName: false });
  const labelHarness = await PiTuiHarness.start({
    name: "branch-label-fallback-atomicity",
    root,
    runDirectory,
    persistSession: true,
    cliArguments: ["--session-dir", sessions, "--session", labelPair.source],
    model: "branch-merge-e2e/fake",
    extensions: [
      "extensions/branch-merge.ts",
      "extensions/test/e2e/fixture/branch-merge-provider.ts",
    ],
    environment: { PI_E2E_BRANCH_MERGE_FAIL_LABEL: "1" },
  });
  try {
    await submitCommand(
      labelHarness,
      `/merge ${labelPair.targetId.slice(0, 8)}`,
    );
    await labelHarness.waitFor("Merge complete. Select next action:", 15_000);
    const labelEntries = readFileSync(labelPair.target, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const summaryIndex = labelEntries.findIndex(
      (entry) => entry.type === "branch_summary",
    );
    labelHarness.assert(
      summaryIndex >= 0,
      "Label failure fallback did not write summary",
    );
    labelHarness.assert(
      labelEntries[summaryIndex + 1]?.type === "label",
      "Label failure fallback left a partial summary write",
    );
    labelHarness.assert(
      labelEntries[summaryIndex + 1]?.label === labelPair.sourceId.slice(0, 8),
      "Label failure did not use source-id fallback",
    );
    await labelHarness.sendKeys("Escape");
    await labelHarness.waitFor("Merged into target session");
    await labelHarness.finish();
  } finally {
    await labelHarness.abort().catch(() => undefined);
  }

  const watcherPair = createPair("watcherx");
  const watcherTarget = await PiTuiHarness.start({
    name: "branch-watcher-target",
    root,
    runDirectory,
    persistSession: true,
    cliArguments: ["--session-dir", sessions, "--session", watcherPair.target],
    model: "branch-merge-e2e/fake",
    extensions: [
      "extensions/branch-merge.ts",
      "extensions/test/e2e/fixture/branch-merge-provider.ts",
    ],
  });
  const watcherSource = await PiTuiHarness.start({
    name: "branch-watcher-source",
    root,
    runDirectory,
    persistSession: true,
    cliArguments: ["--session-dir", sessions, "--session", watcherPair.source],
    model: "branch-merge-e2e/fake",
    extensions: [
      "extensions/branch-merge.ts",
      "extensions/test/e2e/fixture/branch-merge-provider.ts",
    ],
  });
  try {
    await watcherTarget.sendLiteral("WATCHER_SAFE_DRAFT");
    await submitCommand(
      watcherSource,
      `/merge ${watcherPair.targetId.slice(0, 8)}`,
    );
    await watcherSource.waitFor("Merge complete. Select next action:", 15_000);
    await watcherSource.sendKeys("Escape");
    await watcherSource.waitFor("Merged into target session");
    await Bun.sleep(1_500);
    let targetPane = await watcherTarget.capture();
    watcherTarget.assert(
      targetPane.includes("WATCHER_SAFE_DRAFT"),
      "External merge watcher erased editor draft",
    );
    watcherTarget.assert(
      !targetPane.includes("Branch summary"),
      "External merge watcher refreshed over a draft",
    );
    await watcherTarget.sendKeys("C-u");
    await watcherTarget.waitFor("Branch summary", 8_000);
    await watcherSource.finish();
    await watcherTarget.finish();
  } finally {
    await watcherSource.abort().catch(() => undefined);
    await watcherTarget.abort().catch(() => undefined);
  }

  const samePanePair = createPair("branchsp", { parent: false });
  const samePaneHarness = await PiTuiHarness.start({
    name: "branch-same-pane-race",
    root,
    runDirectory,
    persistSession: true,
    cliArguments: ["--session-dir", sessions, "--session", samePanePair.source],
    model: "branch-merge-e2e/fake",
    extensions: [
      "extensions/branch-merge.ts",
      "extensions/test/e2e/fixture/branch-merge-provider.ts",
    ],
  });
  try {
    await submitCommand(samePaneHarness, "/branch BRANCH_FIRST_PROMPT");
    await samePaneHarness.waitFor("Forked to new session", 8_000);
    await samePaneHarness.sendLiteral("BRANCH_RACE_DRAFT");
    await Bun.sleep(500);
    const pane = await samePaneHarness.capture();
    samePaneHarness.assert(
      pane.includes("BRANCH_RACE_DRAFT"),
      "Same-pane branch async submit cleared a new draft",
    );
    await samePaneHarness.sendKeys("C-u", "Escape");
    await samePaneHarness.finish();
  } finally {
    await samePaneHarness.abort().catch(() => undefined);
  }

  const streamingPair = createPair("streambr", { parent: false });
  const streamingCapture = join(
    runDirectory,
    "streaming-branch-provider.jsonl",
  );
  const streamingHarness = await PiTuiHarness.start({
    name: "branch-streaming-pane",
    root,
    runDirectory,
    persistSession: true,
    cliArguments: [
      "--session-dir",
      sessions,
      "--session",
      streamingPair.source,
    ],
    model: "branch-merge-e2e/fake",
    extensions: [
      "extensions/branch-merge.ts",
      "extensions/test/e2e/fixture/branch-merge-provider.ts",
    ],
    environment: {
      PI_E2E_BRANCH_MERGE_CAPTURE: streamingCapture,
      PI_E2E_BRANCH_MERGE_DELAY: "1",
    },
  });
  try {
    await streamingHarness.submit("STREAMING_BRANCH_USER");
    await streamingHarness.waitUntil(
      "streaming provider call",
      () => existsSync(streamingCapture),
      8_000,
    );
    await streamingHarness.sendKeys("C-M-v");
    const socket = join(runDirectory, "branch-streaming-pane.tmux.sock");
    await streamingHarness.waitUntil(
      "streaming branch pane",
      async () => {
        const output =
          await Bun.$`tmux -S ${socket} list-panes -a -F '#{pane_id}'`
            .quiet()
            .nothrow()
            .text();
        return output.trim().split("\n").filter(Boolean).length === 2;
      },
      8_000,
    );
    const ids = (
      await Bun.$`tmux -S ${socket} list-panes -a -F '#{pane_id}'`.text()
    )
      .trim()
      .split("\n");
    const child = ids.find((id) => id !== streamingHarness.paneId);
    streamingHarness.assert(
      child,
      "Streaming branch shortcut did not create a pane",
    );
    const branchFiles = [...new Bun.Glob("*.jsonl").scanSync(sessions)]
      .map((name) => join(sessions, name))
      .filter(
        (path) =>
          path !== streamingPair.source &&
          readFileSync(path, "utf8").includes("streambr SOURCE DELTA"),
      );
    streamingHarness.assert(
      branchFiles.length === 1,
      "Streaming branch did not fork prior source context",
    );
    streamingHarness.assert(
      !readFileSync(branchFiles[0]!, "utf8").includes("STREAMING_BRANCH_USER"),
      "Streaming branch copied the active user turn",
    );
    await Bun.$`tmux -S ${socket} kill-pane -t ${child!}`.quiet().nothrow();
    await streamingHarness.sendKeys("Escape");
    await streamingHarness.finish();
  } finally {
    await streamingHarness.abort().catch(() => undefined);
  }

  console.log(
    "PASS branch-merge historical, atomicity, watcher, branch, pull, and tmux suite",
  );
} finally {
  await harness.abort().catch(() => undefined);
  await cleanupRun(runDirectory);
}
