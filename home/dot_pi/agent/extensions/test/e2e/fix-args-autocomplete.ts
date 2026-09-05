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

try {
  const harness = await PiTuiHarness.start({
    name: "fix-args-autocomplete",
    root,
    runDirectory,
    extensions: [
      "extensions/test/e2e/fixture/ui-probe.ts",
      "extensions/test/e2e/fixture/fix-args-autocomplete-probe.ts",
      "extensions/skill-autocomplete.ts",
      "extensions/fix-args-autocomplete.ts",
    ],
    skills: ["extensions/test/e2e/fixture/skills/alpha/SKILL.md"],
  });
  await harness.waitFor("UI PROBE READY");
  await harness.sendLiteral("/e2e-multi ");
  await harness.waitFor("E2E FIRST ARGUMENT");
  await harness.sendKeys("Tab");
  await harness.waitFor("E2E SECOND ARGUMENT");
  await harness.sendKeys("Tab");
  await harness.waitUntil("terminal completion list close", async () => {
    const pane = await harness.capture();
    return (
      pane.includes("/e2e-multi alpha beta") &&
      !pane.includes("E2E SECOND ARGUMENT")
    );
  });
  await harness.sendKeys("Enter");
  await harness.waitFor("E2E MULTI RESULT alpha beta");

  await harness.sendLiteral("/e2e-multi ");
  await harness.waitFor("E2E FIRST ARGUMENT");
  await harness.sendKeys("Tab");
  await harness.waitFor("E2E SECOND ARGUMENT");
  await harness.sendKeys("Tab");
  await harness.waitUntil("completed command arguments", async () => {
    const pane = await harness.capture();
    return (
      pane.includes("/e2e-multi alpha beta") &&
      !pane.includes("E2E SECOND ARGUMENT")
    );
  });
  await harness.sendLiteral("/alp");
  const skillMenu = await harness.waitFor("E2E inline skill completion marker");
  harness.assert(
    skillMenu.includes("→ skill:alpha"),
    "Skill menu did not open after completed command arguments",
  );
  await harness.sendKeys("Tab");
  const completedSkill = await harness.waitFor(
    "/e2e-multi alpha beta /skill:alpha",
  );
  harness.assert(
    !completedSkill.includes("No files found"),
    "Skill completion after command arguments fell through to file completion",
  );
  await harness.sendKeys("C-u");
  console.log("PASS fix-args-autocomplete skill-after-completed-args-4545718a");

  await harness.sendLiteral("/e2e-async ");
  await harness.waitFor("E2E ASYNC FIRST");
  await harness.sendKeys("Tab");
  await harness.sendLiteral("x");
  await Bun.sleep(650);
  const cancelledPane = await harness.capture();
  harness.assert(
    cancelledPane.includes("/e2e-async first x"),
    "Editing during delayed completion did not preserve the accepted argument",
  );
  harness.assert(
    !cancelledPane.includes("E2E ASYNC SECOND"),
    "A stale delayed completion list opened after the user edited the command",
  );
  await harness.sendKeys("Enter");
  await harness.waitFor("E2E ASYNC RESULT first x");

  await harness.sendLiteral("/e2e-reject ");
  await harness.waitFor("E2E REJECT FIRST");
  await harness.sendKeys("Tab");
  await harness.waitUntil("failed completion list close", async () => {
    const pane = await harness.capture();
    return (
      pane.includes("/e2e-reject first") && !pane.includes("E2E REJECT FIRST")
    );
  });
  await harness.sendKeys("Enter");
  await harness.waitFor("E2E REJECT RESULT first");

  await harness.submit("/reload");
  await harness.waitFor("Reloaded");
  await harness.sendLiteral("/e2e-multi ");
  await harness.waitFor("E2E FIRST ARGUMENT");
  await harness.sendKeys("Escape", "C-u");

  await finish(harness);
  console.log(
    "PASS fix-args-autocomplete: multi-step, terminal, stale async cancellation, rejection, and reload",
  );
} finally {
  await cleanupRun(runDirectory);
}
