import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanupRun, makeRunDirectory, PiTuiHarness } from "./harness.ts";
import { submitCommand } from "./generated-state-helpers.ts";

const root = resolve(import.meta.dir, "../../..");
const runDirectory = makeRunDirectory(root);
const capturePath = `${runDirectory}/tmux-kitty-images.json`;
const ESC = "\x1b";
const WRAPPED_APC = /\x1bPtmux;\x1b\x1b_G([^\x1b]*)\x1b\x1b\\\x1b\\/g;

async function inactiveScenario(): Promise<void> {
  const inactiveCapture = `${runDirectory}/tmux-kitty-images-inactive.json`;
  const inactive = await PiTuiHarness.start({
    name: "tmux-kitty-images-inactive",
    root,
    runDirectory,
    extensions: [
      "extensions/tmux-kitty-images.ts",
      "extensions/test/e2e/fixture/tmux-kitty-images-probe.ts",
    ],
    environment: {
      PI_E2E_TMUX_IMAGE_CAPTURE: inactiveCapture,
      GHOSTTY_RESOURCES_DIR: "",
      KITTY_WINDOW_ID: "",
      TERM: "tmux-256color",
      TERM_PROGRAM: "unknown-terminal",
      WEZTERM_PANE: "",
    },
  });
  await inactive.waitFor("TMUX KITTY IMAGE PROBE READY");
  await inactive.finish();
  const bytes = readFileSync(inactive.logPath, "utf8");
  const capture = JSON.parse(readFileSync(inactiveCapture, "utf8")) as {
    placeholdersBefore: number;
    placeholdersAfter: number;
  };
  inactive.assert(
    capture.placeholdersBefore === 0 && capture.placeholdersAfter === 0,
    "Inactive extension installed Unicode image placeholders",
  );
  inactive.assert(
    !bytes.includes("tmux;"),
    "Inactive extension emitted tmux passthrough bytes",
  );
  console.log("PASS tmux-kitty-images inactive-environment");
}

await inactiveScenario();

const harness = await PiTuiHarness.start({
  name: "tmux-kitty-images",
  root,
  runDirectory,
  extensions: [
    "extensions/tmux-kitty-images.ts",
    "extensions/test/e2e/fixture/tmux-kitty-images-probe.ts",
  ],
  environment: {
    KITTY_WINDOW_ID: "1",
    PI_E2E_TMUX_IMAGE_CAPTURE: capturePath,
    TERM: "tmux-256color",
    TERM_PROGRAM: "kitty",
  },
});

try {
  await harness.waitFor("TMUX KITTY IMAGE PROBE READY");
  const overlay = JSON.parse(readFileSync(capturePath, "utf8"));
  harness.assert(
    overlay.composedWidth === 12,
    `Overlay width changed: ${overlay.composedWidth}`,
  );
  harness.assert(
    overlay.composed.includes("OVER"),
    "Overlay text was not composed",
  );
  harness.assert(
    overlay.placeholdersBefore > 0,
    "Overlay erased all leading image cells",
  );
  harness.assert(
    overlay.placeholdersAfter > 0,
    "Overlay erased all trailing image cells",
  );

  const beforeScrollLength = readFileSync(harness.logPath, "utf8").length;
  await submitCommand(harness, "/e2e-tmux-scroll");
  await harness.waitFor("TMUX KITTY SCROLL READY", 8_000);
  await harness.waitFor("TMUX KITTY SCROLL LINE 79", 8_000);
  const scrollBytes = readFileSync(harness.logPath, "utf8").slice(
    beforeScrollLength,
  );
  const nativeSynchronizedOutputIndex = scrollBytes.indexOf(`${ESC}[?2026h`);
  const nativeDeleteVisibleIndex = scrollBytes.indexOf("a=d,d=a");
  const nativeScrollRegionIndex =
    scrollBytes.match(/\x1b\[\d+;\d+r/)?.index ?? -1;
  harness.assert(
    nativeSynchronizedOutputIndex >= 0 &&
      nativeSynchronizedOutputIndex < nativeDeleteVisibleIndex &&
      nativeDeleteVisibleIndex < nativeScrollRegionIndex,
    "Deterministic native-scroll repaint did not emit synchronized output, d=a, then scroll region",
  );

  const socketPath = `${runDirectory}/tmux-kitty-images.tmux.sock`;
  const resize = Bun.spawnSync([
    "tmux",
    "-S",
    socketPath,
    "resize-window",
    "-t",
    "tmux-kitty-images",
    "-x",
    "64",
    "-y",
    "32",
  ]);
  harness.assert(
    resize.exitCode === 0,
    `tmux resize failed: ${resize.stderr.toString()}`,
  );
  await Bun.sleep(300);

  const beforeRepaintLength = readFileSync(harness.logPath, "utf8").length;
  await submitCommand(harness, "/e2e-tmux-repaint");
  await harness.waitFor("TMUX KITTY REPAINT READY", 8_000);
  const repaintBytes = readFileSync(harness.logPath, "utf8").slice(
    beforeRepaintLength,
  );
  const synchronizedOutputIndex = repaintBytes.indexOf(`${ESC}[?2026h`);
  const deleteVisibleIndex = repaintBytes.indexOf("a=d,d=a");
  const scrollRegionIndex = repaintBytes.match(/\x1b\[\d+;\d+r/)?.index ?? -1;
  harness.assert(
    synchronizedOutputIndex >= 0 &&
      synchronizedOutputIndex < deleteVisibleIndex &&
      deleteVisibleIndex < scrollRegionIndex,
    "Integrated repaint did not emit synchronized output, d=a, then scroll region",
  );

  await harness.sendLiteral("/reload");
  await harness.sendKeys("Enter");
  await harness.waitFor("Reloaded keybindings", 8_000);
  await submitCommand(harness, "/e2e-tmux-repaint");
  await harness.waitFor("TMUX KITTY REPAINT READY", 8_000);
  await harness.finish();
  const bytes = readFileSync(harness.logPath, "utf8");
  const commands = [...bytes.matchAll(WRAPPED_APC)].map((match) => match[1]!);
  harness.assert(
    commands.length > 0,
    "No tmux-wrapped Kitty commands were emitted",
  );

  const transmissions = commands.filter((command) => command.includes("a=t"));
  harness.assert(
    transmissions.length === 2,
    `Initial load plus reload transmitted identical image bytes ${transmissions.length} times`,
  );
  const transmissionIndex = commands.indexOf(transmissions[0]!);
  let reconstructed = "";
  for (let index = transmissionIndex; index < commands.length; index += 1) {
    const command = commands[index]!;
    if (index !== transmissionIndex && !command.startsWith("m=")) break;
    reconstructed += command.slice(command.indexOf(";") + 1);
    if (command.includes("m=0")) break;
  }
  harness.assert(
    reconstructed === "A".repeat(5_000),
    "Chunked image payload changed",
  );

  const placements = commands
    .map((command) => command.match(/a=p,U=1,i=(\d+),p=(\d+),c=(\d+),r=(\d+)/))
    .filter((match): match is RegExpMatchArray => Boolean(match));
  harness.assert(
    placements.length >= 4,
    `Resize and reload emitted only ${placements.length} placements`,
  );
  const imageIds = new Set(placements.map((match) => Number(match[1])));
  const placementIds = new Set(placements.map((match) => Number(match[2])));
  harness.assert(
    imageIds.size === 2,
    "Each load did not deduplicate identical image bytes to one image ID",
  );
  harness.assert(
    placementIds.size >= 4,
    "Resize and reload reused placement IDs across distinct render states",
  );
  for (const id of [...imageIds, ...placementIds]) {
    harness.assert(
      id > 0 && id <= 0xffffff,
      `Kitty ID is outside 24 bits: ${id}`,
    );
  }

  const withoutWrappedCommands = bytes.replace(WRAPPED_APC, "");
  harness.assert(
    !withoutWrappedCommands.includes(`${ESC}_G`),
    "A direct Kitty APC escaped tmux wrapping",
  );
  harness.assert(
    !bytes.includes(`${ESC}Ptmux;${ESC}${ESC}Ptmux;`),
    "Reload nested tmux passthrough wrappers",
  );
  harness.assert(
    commands.some((command) => command.includes("a=d,d=A")),
    "Exit did not delete terminal-global placements",
  );

  console.log("PASS tmux-kitty-images historical protocol regression suite");
} finally {
  await harness.abort().catch(() => undefined);
  await cleanupRun(runDirectory);
}
