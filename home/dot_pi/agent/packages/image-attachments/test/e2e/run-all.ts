import { runScenarios, type Scenario } from "./scenario-runner.ts";

const scenarios: Scenario[] = [
  { name: "ctrl-v-image", command: ["expect", "test/e2e/ctrl-v-image.expect"] },
  {
    name: "slash-command-image-path",
    command: ["expect", "test/e2e/slash-command-image-path.expect"],
  },
  { name: "tmux-thumbnail", command: ["expect", "test/e2e/tmux-thumbnail.expect"] },
  { name: "provider-flow", command: [process.execPath, "test/e2e/provider-flow.ts"] },
  { name: "input-boundaries", command: [process.execPath, "test/e2e/input-boundaries.ts"] },
  { name: "tool-loop", command: [process.execPath, "test/e2e/tool-loop.ts"] },
  { name: "atomic-editor", command: [process.execPath, "test/e2e/atomic-editor.ts"] },
  { name: "submit-guards", command: [process.execPath, "test/e2e/submit-guards.ts"] },
  { name: "materialization", command: [process.execPath, "test/e2e/materialization.ts"] },
  { name: "paste-chunking", command: [process.execPath, "test/e2e/paste-chunking.ts"] },
  { name: "queued-streaming", command: [process.execPath, "test/e2e/queued-streaming.ts"] },
  {
    name: "lifecycle-tree",
    command: [process.execPath, "test/e2e/lifecycle.ts", "--branch=tree"],
  },
  {
    name: "lifecycle-compaction",
    command: [process.execPath, "test/e2e/lifecycle.ts", "--branch=compaction"],
  },
  {
    name: "format-provider-fallback",
    command: [process.execPath, "test/e2e/format-matrix.ts", "--branch=provider"],
  },
  {
    name: "format-kitty-png",
    command: [
      process.execPath,
      "test/e2e/format-matrix.ts",
      "--branch=kitty",
      "--format=png",
    ],
  },
];

await runScenarios(scenarios, {
  cwd: `${import.meta.dir}/../..`,
  mode: "green",
  suiteName: "image-attachments E2E",
});
