import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  cleanupRun,
  makeRunDirectory,
  PiTuiHarness,
} from "../../../../extensions/test/e2e/harness.ts";

const EXPECTED_VERSION = process.env.PI_E2E_EXPECT_VERSION ?? "0.84.4";
const agentRoot = resolve(import.meta.dir, "../../../..");
const packageRoot = resolve(import.meta.dir, "../..");
const runDirectory = makeRunDirectory(agentRoot);
const manifest = JSON.parse(readFileSync(join(packageRoot, "upstream.json"), "utf8"));

const piExecutable = Bun.which("pi");
if (!piExecutable) throw new Error("Pi is not on PATH.");
const resolvedPi = realpathSync(piExecutable);
const version = Bun.spawnSync([resolvedPi, "--version"]).stdout.toString().trim();
if (version !== EXPECTED_VERSION) {
  throw new Error(`Expected Pi ${EXPECTED_VERSION}, got ${version}.`);
}

const piPackageRoot = join(
  dirname(resolvedPi),
  "..",
  "@earendil-works",
  "pi-coding-agent",
);
const loaderPath = join(
  piPackageRoot,
  "dist",
  "modes",
  "interactive",
  "theme",
  "theme.js",
);
const loader = await import(pathToFileURL(loaderPath).href);
if (typeof loader.loadThemeFromPath !== "function") {
  throw new Error(`Pi ${version} does not export loadThemeFromPath.`);
}

for (const mode of ["truecolor", "256color"] as const) {
  for (const name of manifest.themes as string[]) {
    const theme = loader.loadThemeFromPath(
      join(packageRoot, "themes", `${name}.json`),
      mode,
    );
    if (theme.name !== name) {
      throw new Error(`${name} loaded as ${String(theme.name)} in ${mode} mode.`);
    }
  }
}

const renderCases = [
  { name: "dark-poimandres", mode: "truecolor" as const, width: 90 },
  { name: "light-poimandres", mode: "truecolor" as const, width: 90 },
  { name: "dark", mode: "256color" as const, width: 90 },
  { name: "light", mode: "256color" as const, width: 90 },
  { name: "alabaster", mode: "truecolor" as const, width: 34 },
];

try {
  await Promise.all(renderCases.map(async (testCase) => {
    const id = `${testCase.name}-${testCase.mode}`;
    const capturePath = join(runDirectory, `${id}.json`);
    const expectedTheme = loader.loadThemeFromPath(
      join(packageRoot, "themes", `${testCase.name}.json`),
      testCase.mode,
    );
    const expectedStyledText = expectedTheme.fg("text", "THEME_TEXT_PROBE");
    const harness = await PiTuiHarness.start({
      name: `theme-${id}`,
      root: agentRoot,
      runDirectory,
      width: testCase.width,
      extensions: [
        "packages/oh-my-pi-themes/test/e2e/fixture/theme-probe.ts",
        "packages/oh-my-pi-themes",
      ],
      cliArguments: ["--use-theme", testCase.name],
      environment: {
        PI_E2E_THEME_CAPTURE: capturePath,
        COLORTERM: testCase.mode === "truecolor" ? "truecolor" : "",
        TERM: "xterm-256color",
      },
    });
    await harness.waitFor("THEME E2E READY");
    const captures = JSON.parse(readFileSync(capturePath, "utf8"));
    const capture = captures.at(-1);
    harness.assert(capture.colorMode === testCase.mode, `${id} used the wrong color mode.`);
    harness.assert(
      capture.styledText === expectedStyledText,
      `${id} resolved the wrong text color: ${JSON.stringify(capture.styledText)}`,
    );
    await harness.finish();
    const bytes = readFileSync(harness.logPath, "utf8");
    harness.assert(
      bytes.includes(capture.styledText),
      `${id} styled probe was not emitted by the real TUI.`,
    );
  }));

  const switchCapture = join(runDirectory, "live-switch.json");
  const switchHarness = await PiTuiHarness.start({
    name: "theme-live-switch",
    root: agentRoot,
    runDirectory,
    extensions: [
      "packages/oh-my-pi-themes/test/e2e/fixture/theme-probe.ts",
      "packages/oh-my-pi-themes",
    ],
    cliArguments: ["--use-theme", "dark-poimandres"],
    environment: { PI_E2E_THEME_CAPTURE: switchCapture },
  });
  await switchHarness.waitFor("THEME E2E READY");
  await switchHarness.submitCommand("settings");
  await switchHarness.waitFor("Type to search");
  await switchHarness.sendLiteral("Theme");
  await switchHarness.waitFor("Color theme for the interface");
  await switchHarness.sendKeys("Enter");
  await switchHarness.waitFor("Select a theme");
  const switchedThemeName = "dark-rainforest";
  switchHarness.assert(
    (manifest.themes as string[]).includes(switchedThemeName),
    `${switchedThemeName} is absent from the theme inventory`,
  );
  await switchHarness.sendKeys("Down");
  await switchHarness.waitFor(switchedThemeName);
  await switchHarness.sendKeys("Enter", "Escape");
  let stableClosedFrames = 0;
  await switchHarness.waitUntil("settings close after theme switch", async () => {
    const closed = !(await switchHarness.capture()).includes(
      "Color theme for the interface",
    );
    stableClosedFrames = closed ? stableClosedFrames + 1 : 0;
    return stableClosedFrames >= 3;
  });
  await switchHarness.submitCommand("theme-probe-capture");
  await switchHarness.waitUntil("second theme capture", () =>
    JSON.parse(readFileSync(switchCapture, "utf8")).length === 2,
  );
  const switched = JSON.parse(readFileSync(switchCapture, "utf8"));
  const expectedSwitched = loader
    .loadThemeFromPath(join(packageRoot, `themes/${switchedThemeName}.json`), "truecolor")
    .fg("text", "THEME_TEXT_PROBE");
  switchHarness.assert(switched[1].styledText === expectedSwitched, "Live theme switch did not update extension context theme");
  await switchHarness.submitCommand("reload");
  await switchHarness.waitFor("Reloaded keybindings, extensions, skills, prompts, themes, and context files");
  const capturesAfterReload = JSON.parse(readFileSync(switchCapture, "utf8")).length;
  await switchHarness.submitCommand("theme-probe-capture");
  await switchHarness.waitUntil("theme capture after reload", () =>
    JSON.parse(readFileSync(switchCapture, "utf8")).length > capturesAfterReload,
  );
  const afterReload = JSON.parse(readFileSync(switchCapture, "utf8"));
  switchHarness.assert(afterReload.at(-1).styledText === expectedSwitched, "Extension reload lost the live-selected package theme");
  await switchHarness.finish();

  console.log(
    `PASS oh-my-pi-themes: ${manifest.themes.length} themes in two color modes plus five real-TUI mode/width cases, live switch, and reload`,
  );
} finally {
  await cleanupRun(runDirectory);
}
