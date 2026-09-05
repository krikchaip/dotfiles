import { runFiles } from "../../../../extensions/test/e2e/run-files.ts";

await runFiles(import.meta.dir, ["run.ts", "negative.ts", "sync.ts"]);
