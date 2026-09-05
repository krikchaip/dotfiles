import { runFiles } from "../../../../extensions/test/e2e/run-files.ts";

await runFiles(import.meta.dir, [
  "run.ts",
  "tmux-actions.ts",
  "general.ts",
  "historical-regressions.ts",
]);
