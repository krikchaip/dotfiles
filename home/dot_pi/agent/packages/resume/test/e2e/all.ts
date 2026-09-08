import { runFiles } from "../../../../extensions/test/e2e/run-files.ts";

await runFiles(
  import.meta.dir,
  [
    "run.ts",
    "tmux-actions.ts",
    "tmux-prime-regression.ts",
    "tmux-cold-branch-regression.ts",
    "tmux-warm-cache-adoption.ts",
    "cold-indexing-lifecycle.ts",
    "cold-all-directories.ts",
    "partial-cache.ts",
    "delete-transition-regression.ts",
    "delete-reconciliation-regression.ts",
    "general.ts",
    "historical-regressions.ts",
  ],
  4,
);
