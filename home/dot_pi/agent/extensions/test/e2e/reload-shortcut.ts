import { readFileSync } from "node:fs";
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
  const countPath = `${runDirectory}/reload-count.txt`;
  const harness = await PiTuiHarness.start({
    name: "reload-shortcut",
    root,
    runDirectory,
    extensions: [
      "extensions/test/e2e/fixture/reload-probe.ts",
      "extensions/reload-shortcut.ts",
    ],
    environment: { PI_E2E_RELOAD_COUNT: countPath },
  });
  await harness.waitFor("RELOAD PROBE 1");
  await harness.sendLiteral("draft-marker");
  await harness.sendLiteral("\x1b[114;7u");
  const pane = await harness.waitFor("RELOAD PROBE 2", 12_000);
  harness.assert(
    pane.includes("draft-marker"),
    "Reload shortcut did not preserve the editor draft",
  );
  harness.assert(
    !pane.includes("/__reload-shortcut"),
    "Internal reload command became visible TUI text",
  );

  await harness.sendLiteral("\x1b[114;7u");
  const secondPane = await harness.waitFor("RELOAD PROBE 3", 12_000);
  harness.assert(
    secondPane.includes("draft-marker"),
    "A repeated reload shortcut lost the editor draft",
  );
  harness.assert(
    readFileSync(countPath, "utf8").trim() === "3",
    "Repeated shortcut did not cause exactly one reload",
  );
  harness.assert(
    !secondPane.includes("/__reload-shortcut"),
    "Repeated internal reload command became visible TUI text",
  );
  await finish(harness);
  console.log(
    "PASS reload-shortcut: exact shortcut, repeated reload, draft preservation, and hidden command",
  );
} finally {
  await cleanupRun(runDirectory);
}
