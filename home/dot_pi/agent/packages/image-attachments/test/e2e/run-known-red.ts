import { runScenarios, type Scenario } from "./scenario-runner.ts";

const scenarios: Scenario[] = [
  {
    name: "lifecycle-restart-image-restore",
    command: [process.execPath, "test/e2e/lifecycle.ts", "--branch=restart"],
    knownRedMarker: "Restarted session did not restore submitted image bytes.",
  },
  {
    name: "kitty-jpeg-conversion",
    command: [
      process.execPath,
      "test/e2e/format-matrix.ts",
      "--branch=kitty",
      "--format=jpg",
    ],
    knownRedMarker: "Timed out waiting for Kitty image/jpeg conversion.",
  },
  {
    name: "kitty-gif-conversion",
    command: [
      process.execPath,
      "test/e2e/format-matrix.ts",
      "--branch=kitty",
      "--format=gif",
    ],
    knownRedMarker: "Timed out waiting for Kitty image/gif conversion.",
  },
  {
    name: "kitty-webp-conversion",
    command: [
      process.execPath,
      "test/e2e/format-matrix.ts",
      "--branch=kitty",
      "--format=webp",
    ],
    knownRedMarker: "Timed out waiting for Kitty image/webp conversion.",
  },
];

await runScenarios(scenarios, {
  cwd: `${import.meta.dir}/../..`,
  mode: "known-red",
  suiteName: "image-attachments known-red",
});
