import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

interface Capture {
  styledText: string;
  colorMode: string;
}

export default function themeProbe(pi: ExtensionAPI): void {
  const capturePath = process.env.PI_E2E_THEME_CAPTURE;
  if (!capturePath) throw new Error("PI_E2E_THEME_CAPTURE is required.");

  const capture = (context: ExtensionContext): void => {
    const styledText = context.ui.theme.fg("text", "THEME_TEXT_PROBE");
    const previous = existsSync(capturePath)
      ? (JSON.parse(readFileSync(capturePath, "utf8")) as Capture[])
      : [];
    previous.push({ styledText, colorMode: context.ui.theme.getColorMode() });
    const stagedPath = `${capturePath}.tmp`;
    writeFileSync(stagedPath, JSON.stringify(previous));
    renameSync(stagedPath, capturePath);
    context.ui.setWidget("theme-e2e", [styledText, "THEME E2E READY"]);
  };

  pi.on("session_start", (_event, context) => capture(context));
  pi.registerCommand("theme-probe-capture", {
    description: "Capture the active theme for E2E tests",
    handler: async (_args, context) => capture(context),
  });
}
