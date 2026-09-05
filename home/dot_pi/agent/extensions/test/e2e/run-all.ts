type Suite = {
  file: string;
  expectedBaselineFailures?: string[];
};

type Options = {
  jobs: number;
  match?: RegExp;
  list: boolean;
};

const suites: Suite[] = [
  {
    file: "auto-compact.ts",
    expectedBaselineFailures: [
      "PRODUCT DEFECT: failed automatic compaction did not arm one-turn backoff",
      "Stale compaction made a continuation provider call",
    ],
  },
  { file: "auto-rename.ts" },
  { file: "blinking-cursor.ts" },
  { file: "branch-merge.ts" },
  { file: "branch-summary-model.ts" },
  { file: "clear-copied-selection.ts" },
  { file: "color-highlight.ts" },
  { file: "dedup-compaction-banner.ts" },
  {
    file: "dot-continue.ts",
    expectedBaselineFailures: [
      "[context/retry-error]",
      "[context/repeated-continue]",
      "[graph/dangling-parent]",
      "[graph/reparent-survivor]",
    ],
  },
  { file: "drop-session.ts" },
  { file: "fix-args-autocomplete.ts" },
  { file: "kitty-alt-keys.ts" },
  { file: "model-selector-cursor.ts" },
  {
    file: "new-child-split.ts",
    expectedBaselineFailures: [
      "Failed child Pi startup left an orphan child session file",
    ],
  },
  {
    file: "parent-session.ts",
    expectedBaselineFailures: [
      "Parent header rewrite lost a concurrent session append",
    ],
  },
  { file: "post-compaction-context.ts" },
  { file: "reload-shortcut.ts" },
  { file: "safe-terminal-output.ts" },
  { file: "skill-autocomplete.ts" },
  { file: "skill-expansion.ts" },
  { file: "slash-highlight.ts" },
  { file: "stable-scroll-indicator.ts" },
  { file: "themed-dialog-borders.ts" },
  { file: "thinking-summary.ts" },
  { file: "tmux-kitty-images.ts" },
  { file: "tree-confirm-summary.ts" },
  {
    file: "tree-delete-mode.ts",
    expectedBaselineFailures: [
      "Rewrite failure did not roll back in-memory entries",
    ],
  },
  { file: "undo-redo.ts" },
];

function parseOptions(args: string[]): Options {
  const options: Options = { jobs: 4, list: false };

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--serial") {
      options.jobs = 1;
      continue;
    }
    if (argument === "--list") {
      options.list = true;
      continue;
    }
    if (argument === "--jobs") {
      const value = Number.parseInt(args[++index] ?? "", 10);
      if (!Number.isSafeInteger(value) || value < 1 || value > 8) {
        throw new Error("--jobs must be an integer from 1 through 8");
      }
      options.jobs = value;
      continue;
    }
    if (argument === "--match") {
      const value = args[++index];
      if (!value) throw new Error("--match requires a regular expression");
      options.match = new RegExp(value);
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

function elapsedSeconds(startedAt: number): string {
  return `${((performance.now() - startedAt) / 1_000).toFixed(1)}s`;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const selected = options.match
    ? suites.filter((suite) => options.match!.test(suite.file))
    : suites;

  if (options.list) {
    for (const suite of selected) console.log(suite.file);
    return;
  }
  if (selected.length === 0) throw new Error("No E2E suites matched");

  const bun = Bun.which("bun") ?? process.execPath;
  const cwd = import.meta.dir;
  const unexpected: string[] = [];
  const timings: Array<{ file: string; milliseconds: number }> = [];
  let passed = 0;
  let expectedFailed = 0;
  let nextIndex = 0;
  const matrixStartedAt = performance.now();

  async function runSuite(suite: Suite) {
    const startedAt = performance.now();
    const child = Bun.spawn([bun, suite.file], {
      cwd,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    const milliseconds = performance.now() - startedAt;
    timings.push({ file: suite.file, milliseconds });

    const output = `${stdout}\n${stderr}`;
    const expected = suite.expectedBaselineFailures;
    let verdict: string;

    if (!expected) {
      if (exitCode === 0) {
        passed += 1;
        verdict = `PASS ${suite.file}`;
      } else {
        const failure = `${suite.file}: exited ${exitCode}, expected PASS`;
        unexpected.push(failure);
        verdict = `UNEXPECTED ${failure}`;
      }
    } else {
      const missing = expected.filter((marker) => !output.includes(marker));
      if (exitCode !== 0 && missing.length === 0) {
        expectedFailed += 1;
        verdict = `XFAIL ${suite.file}: known Pi 0.84.4 baseline defect(s)`;
      } else if (exitCode === 0) {
        const failure = `${suite.file}: unexpectedly passed; review whether the baseline defect was fixed`;
        unexpected.push(failure);
        verdict = `UNEXPECTED ${failure}`;
      } else {
        const failure = `${suite.file}: missing expected failure marker(s): ${missing.join(", ")}`;
        unexpected.push(failure);
        verdict = `UNEXPECTED ${failure}`;
      }
    }

    const sections = [
      `\n=== ${suite.file} (${elapsedSeconds(startedAt)}) ===`,
      stdout.trimEnd(),
      stderr.trimEnd(),
      verdict,
    ].filter(Boolean);
    process.stdout.write(`${sections.join("\n")}\n`);
  }

  async function worker() {
    while (true) {
      const index = nextIndex++;
      const suite = selected[index];
      if (!suite) return;
      await runSuite(suite);
    }
  }

  const workerCount = Math.min(options.jobs, selected.length);
  console.log(
    `Running ${selected.length} extension E2E suites with ${workerCount} worker(s)`,
  );
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const slowest = timings
    .sort((left, right) => right.milliseconds - left.milliseconds)
    .slice(0, 5)
    .map(
      ({ file, milliseconds }) =>
        `${file} ${(milliseconds / 1_000).toFixed(1)}s`,
    )
    .join(", ");
  console.log(
    `\nExtension E2E summary: ${passed} PASS, ${expectedFailed} expected baseline failure suites, ${unexpected.length} unexpected in ${elapsedSeconds(matrixStartedAt)}`,
  );
  console.log(`Slowest suites: ${slowest}`);

  if (unexpected.length > 0) process.exitCode = 1;
}

await main();
