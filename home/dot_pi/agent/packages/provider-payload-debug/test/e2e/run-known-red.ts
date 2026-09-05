import { runScenarios, type Scenario } from "./scenario-runner.ts";

const scenarios: Scenario[] = [
  {
    name: "request-write-failure",
    command: [process.execPath, "test/e2e/write-failure.ts"],
    knownRedMarker: "Expected one concise package warning.",
  },
  {
    name: "response-write-failure",
    command: [process.execPath, "test/e2e/response-write-failure.ts"],
    knownRedMarker: "Expected one concise response metadata warning.",
  },
  {
    name: "response-correlation",
    command: [process.execPath, "test/e2e/response-correlation.ts"],
    knownRedMarker: "Capture-off response overwrote captured metadata:",
  },
  {
    name: "event-correlation-lifecycle",
    command: [process.execPath, "test/e2e/event-correlation.ts"],
    knownRedMarker: "Correlation lifecycle handlers were not registered.",
  },
  {
    name: "summary-shapes",
    command: [process.execPath, "test/e2e/summary-shapes.ts"],
    knownRedMarker: "Assistant multi-part output totals are wrong.",
  },
  {
    name: "capture-directory-collision",
    command: [process.execPath, "test/e2e/collision-safety.ts"],
    knownRedMarker: "Expected 8 summaries from concurrent processes, got 1.",
  },
];

await runScenarios(scenarios, {
  cwd: `${import.meta.dir}/../..`,
  mode: "known-red",
  suiteName: "provider-payload-debug known-red",
});
