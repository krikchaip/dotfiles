import { DynamicBorder, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export default function themedDialogBordersProbe(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, context) => {
    const path = process.env.PI_E2E_THEMED_BORDER_CAPTURE;
    if (!path) throw new Error("PI_E2E_THEMED_BORDER_CAPTURE is required");
    const width = 12;
    const line = "─".repeat(width);
    const custom = (text: string) => `CUSTOM<${text}>`;
    const captures = existsSync(path)
      ? (JSON.parse(readFileSync(path, "utf8")) as unknown[])
      : [];
    captures.push({
      expectedAccent: context.ui.theme.fg("accent", line),
      defaultBorder: new DynamicBorder().render(width),
      customBorder: new DynamicBorder(custom).render(width),
      expectedCustom: [custom(line)],
    });
    writeFileSync(path, JSON.stringify(captures, null, 2));
  });
}
