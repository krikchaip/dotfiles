import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanupRun, makeRunDirectory, PiTuiHarness } from "./harness.ts";

const root = resolve(import.meta.dir, "../../..");
const runDirectory = makeRunDirectory(root);

async function finish(harness: PiTuiHarness): Promise<void> {
  try {
    await harness.finish();
  } catch (error) {
    await harness.abort();
    throw error;
  }
}

async function moveDown(harness: PiTuiHarness): Promise<void> {
  for (let step = 0; step < 3; step++) {
    await harness.sendKeys("Down");
    await Bun.sleep(100);
  }
}

try {
  const capturePath = `${runDirectory}/model-selector-cursor.jsonl`;
  const harness = await PiTuiHarness.start({
    name: "model-selector-cursor",
    root,
    runDirectory,
    extensions: [
      "extensions/test/e2e/fixture/model-selector-probe.ts",
      "extensions/model-selector-cursor.ts",
    ],
    model: "selector-e2e/probe-alpha",
    environment: { PI_E2E_MODEL_CURSOR_CAPTURE: capturePath },
  });
  await harness.waitFor("MODEL CURSOR PROBE READY");

  await harness.submit("/model");
  await harness.waitFor("Only showing models from configured providers");
  await moveDown(harness);
  await harness.sendLiteral("p");
  await harness.waitUntil("regular model search observation", () =>
    existsSync(capturePath),
  );
  await harness.sendKeys("Escape");
  await harness.waitUntil(
    "regular model selector close",
    async () =>
      !(await harness.capture()).includes(
        "Only showing models from configured providers",
      ),
  );

  await harness.submit("/scoped-models");
  await harness.waitFor("Model Configuration");
  await moveDown(harness);
  await harness.sendLiteral("p");
  await harness.waitUntil("scoped model search observation", () => {
    if (!existsSync(capturePath)) return false;
    return readFileSync(capturePath, "utf8").trim().split("\n").length >= 2;
  });

  const observations = readFileSync(capturePath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  for (const component of [
    "ModelSelectorComponent",
    "ScopedModelsSelectorComponent",
  ]) {
    const observation = observations.find(
      (item) => item.component === component,
    );
    harness.assert(observation, `${component} search change was not observed`);
    harness.assert(
      observation.selectedBefore >= 2,
      `${component} cursor did not move before search: ${observation.selectedBefore}`,
    );
    harness.assert(
      observation.selectedAfter === 0,
      `${component} cursor did not reset after search: ${observation.selectedAfter}`,
    );
  }
  await harness.sendKeys("Escape");
  await harness.waitUntil(
    "scoped model selector close",
    async () => !(await harness.capture()).includes("Model Configuration"),
  );

  await harness.submit("/reload");
  await harness.waitFor("Reloaded");
  await harness.submit("/model");
  await harness.waitFor("Only showing models from configured providers");
  await moveDown(harness);
  await harness.sendLiteral("p");
  await harness.waitUntil("reloaded model search observation", () => {
    if (!existsSync(capturePath)) return false;
    return readFileSync(capturePath, "utf8").trim().split("\n").length >= 3;
  });
  const reloadedObservation = readFileSync(capturePath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .at(-1);
  harness.assert(
    reloadedObservation?.selectedBefore >= 2 &&
      reloadedObservation?.selectedAfter === 0,
    "Regular model cursor reset failed after extension reload",
  );
  await harness.sendKeys("Escape");
  await harness.waitUntil(
    "reloaded model selector close",
    async () =>
      !(await harness.capture()).includes(
        "Only showing models from configured providers",
      ),
  );
  await finish(harness);
  console.log(
    "PASS model-selector-cursor: regular, scoped, cancel, and reload",
  );
} finally {
  await cleanupRun(runDirectory);
}
