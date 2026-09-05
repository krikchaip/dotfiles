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
    name: "skill-autocomplete",
    root,
    runDirectory,
    extensions: ["extensions/skill-autocomplete.ts"],
    skills: ["extensions/test/e2e/fixture/skills/alpha/SKILL.md"],
  });
  await harness.sendLiteral("Use /alp");
  await harness.waitFor("E2E inline skill completion marker");
  await harness.sendKeys("Tab");
  let pane = await harness.waitFor("Use /skill:alpha");
  harness.assert(
    !pane.includes("No files found"),
    "Inline skill input fell through to file completion",
  );

  await harness.sendKeys("C-u");
  await Bun.$`tmux -S ${`${runDirectory}/skill-autocomplete.tmux.sock`} resize-window -x 55 -y 16`.quiet();
  await harness.sendLiteral("Try (/al");
  await harness.waitFor("alpha");
  await harness.sendKeys("Tab");
  pane = await harness.waitFor("Try (/skill:alpha");
  harness.assert(!pane.includes("No files found"), "Narrow autocomplete fell through to file completion");

  await harness.sendKeys("C-u");
  await harness.sendLiteral("https://alp");
  await Bun.sleep(300);
  pane = await harness.capture();
  harness.assert(!pane.includes("E2E inline skill completion marker"), "URL fragment triggered skill autocomplete");

  await harness.sendKeys("C-u");
  await harness.sendLiteral("/reload");
  await harness.sendKeys("Enter");
  await harness.waitFor("Reloaded");
  await harness.sendLiteral("After reload /alp");
  await harness.waitFor("→ skill:alpha");
  await harness.sendKeys("Tab");
  await harness.waitFor("After reload /skill:alpha");

  await harness.sendKeys("C-u");
  await harness.sendLiteral("/new");
  await harness.sendKeys("Enter");
  await Bun.sleep(500);
  await harness.sendLiteral("After switch /alp");
  await harness.waitFor("→ skill:alpha");
  await harness.sendKeys("Tab");
  await harness.waitFor("After switch /skill:alpha");

  await finish(harness);
  console.log("PASS skill-autocomplete boundaries, resize, reload, and session lifecycle");
} finally {
  await cleanupRun(runDirectory);
}
