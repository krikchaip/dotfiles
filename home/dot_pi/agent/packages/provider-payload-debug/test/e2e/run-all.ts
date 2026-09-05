import { runScenarios, type Scenario } from "./scenario-runner.ts";

const scenarios: Scenario[] = [
  {
    name: "real-tui-capture-flow",
    command: [process.execPath, "test/e2e/run.ts"],
  },
];

await runScenarios(scenarios, {
  cwd: `${import.meta.dir}/../..`,
  mode: "green",
  suiteName: "provider-payload-debug E2E",
});
