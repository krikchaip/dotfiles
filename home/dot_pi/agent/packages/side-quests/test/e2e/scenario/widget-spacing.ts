import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";

import {
  configureBasicDelegation,
  delay,
  fauxSubagentDone,
} from "../provider-support.ts";

function terminalLines(view: string): string[] {
  return view.split("\n").map((line) => line.trimEnd());
}

function lastLineContaining(lines: readonly string[], text: string): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]?.includes(text)) return index;
  }

  return -1;
}

export const widgetSpacing: Scenario = {
  name: "widget-spacing",
  process: {
    extensionFixtures: ["test/e2e/fixture/widget-spacing.ts"],
    extensionsBefore: ["test/e2e/fixture/widget-before.ts"],
    lifecycle: "interactive",
    managed: true,
    positionalPrompt: "Delegate this E2E task now.",
  },
  timeoutMs: 45_000,
  configureProvider(context) {
    if (context.role === "parent") {
      configureBasicDelegation(context, {
        interactive: true,
        prompt: "Stay active for widget spacing E2E.",
      });
      return;
    }

    context.faux.setResponses([
      async () => {
        await delay(3_000);
        return fauxAssistantMessage(fauxText("Spacing child settled."));
      },
      fauxSubagentDone("Spacing child settled."),
    ]);
  },
  async run(harness: E2EHarness) {
    const childPane = await harness.childPane();

    await harness.waitFor("Spacing fixture");
    await harness.waitFor("Side Quests · 1 live");
    await harness.waitFor(/── .* Working ──/, 10_000, childPane);
    await harness.waitFor("[general-purpose]", 10_000, childPane);

    const parentLines = terminalLines(await harness.capture());
    const parentWidget = lastLineContaining(
      parentLines,
      "Side Quests · 1 live",
    );

    harness.assert(
      parentWidget > 0 &&
        parentLines[parentWidget - 1]?.includes("Spacing fixture"),
      `The attached Side Quests widget gained an inter-widget top margin.\n${parentLines.join("\n")}`,
    );

    const childLines = terminalLines(await harness.capture(childPane));
    const childWidget = lastLineContaining(childLines, "[general-purpose]");

    harness.assert(
      childWidget > 0 &&
        childLines[childWidget - 1]?.trim() === "" &&
        childLines[childWidget + 2]?.startsWith("╰") &&
        /^── .* Working ──/.test(childLines[childWidget + 3] ?? ""),
      `The top Side Quests widget or embedded working border has incorrect spacing.\n${childLines.join("\n")}`,
    );

    await harness.waitForStoredText("Spacing child settled.");
    await harness.sendLiteral(childPane, "/subagent-done", true);
    await harness.waitFor("SUBAGENT COMPLETED");
  },
};
