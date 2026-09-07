import { runFiles } from "../../../../extensions/test/e2e/run-files.ts";

await runFiles(import.meta.dir, [
  "run.ts",
  "tmux-actions.ts",
  "tmux-prime-regression.ts",
  "tmux-cold-branch-regression.ts",
  "general.ts",
  "historical-regressions.ts",
]);
