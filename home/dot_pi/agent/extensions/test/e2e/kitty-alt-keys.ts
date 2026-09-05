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
  const harness = await PiTuiHarness.start({
    name: "kitty-alt-keys",
    root,
    runDirectory,
    extensions: [
      "extensions/test/e2e/fixture/key-probe.ts",
      "extensions/kitty-alt-keys.ts",
    ],
  });
  await harness.waitFor("KEY PROBE READY");

  for (const [sequence, marker] of [
    ["\x1ba", "KEY PROBE alt+a"],
    ["\x1bz", "KEY PROBE alt+z"],
    ["\x1bA", "KEY PROBE alt+shift+a"],
    ["\x1bZ", "KEY PROBE alt+shift+z"],
    ["\x1b0", "KEY PROBE alt+0"],
    ["\x1b9", "KEY PROBE alt+9"],
  ] as const) {
    await harness.sendLiteral(sequence);
    await harness.waitFor(marker);
  }

  await harness.sendLiteral("\x1b[97;3u");
  await harness.waitUntil("native CSI-u pass-through", () => {
    const log = readFileSync(harness.logPath, "utf8");
    return log.split("KEY PROBE alt+a").length - 1 === 2;
  });

  await harness.submit("/reload");
  await harness.waitFor("Reloaded");
  await harness.sendLiteral("\x1bz");
  await harness.waitUntil("legacy Alt after reload", () => {
    const log = readFileSync(harness.logPath, "utf8");
    return log.split("KEY PROBE alt+z").length - 1 === 2;
  });

  const log = readFileSync(harness.logPath, "utf8");
  for (const marker of [
    "KEY PROBE alt+shift+a",
    "KEY PROBE alt+shift+z",
    "KEY PROBE alt+0",
    "KEY PROBE alt+9",
  ]) {
    harness.assert(
      log.split(marker).length - 1 === 1,
      `${marker} did not fire exactly once`,
    );
  }
  await finish(harness);
  console.log(
    "PASS kitty-alt-keys: letter, shifted letter, digit, native CSI-u, and reload",
  );
} finally {
  await cleanupRun(runDirectory);
}
