import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import { delay } from "../provider-support.ts";

const CHILD_COUNT = 8;
const MAX_ADDED_INPUT_LATENCY_MS = 25;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY;
}

async function inputLatency(
  harness: E2EHarness,
  marker: string,
): Promise<number> {
  await harness.sendParentKeys("C-u");
  await Bun.sleep(20);

  const start = performance.now();
  await harness.sendParent(marker);
  const deadline = start + 2_000;

  while (performance.now() < deadline) {
    if ((await harness.capture()).includes(marker))
      return performance.now() - start;
    await Bun.sleep(2);
  }

  throw new Error(`Parent editor did not render ${marker}.`);
}

async function medianInputLatency(
  harness: E2EHarness,
  phase: string,
): Promise<number> {
  const samples: number[] = [];
  for (let index = 0; index < 5; index += 1)
    samples.push(await inputLatency(harness, `${phase}-${index}-marker`));
  return median(samples);
}

function selectedRow(view: string): string | undefined {
  return view.split("\n").find((line) => line.includes("›"));
}

async function medianNavigationLatency(harness: E2EHarness): Promise<number> {
  await harness.sendParentKeys("S-Up");
  await harness.waitFor("d close", 5_000);

  const samples: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    const before = selectedRow(await harness.capture());
    const start = performance.now();
    await harness.sendParentKeys("Down");
    const deadline = start + 2_000;

    while (performance.now() < deadline) {
      const after = selectedRow(await harness.capture());
      if (after && after !== before) {
        samples.push(performance.now() - start);
        break;
      }
      await Bun.sleep(2);
    }
  }

  await harness.sendParentKeys("Escape");
  await harness.waitUntil(
    "parent navigation to close",
    async () => !(await harness.capture()).includes("d close"),
    5_000,
  );
  harness.assert(samples.length === 5, "Parent navigation did not repaint.");
  return median(samples);
}

export const parentResponsiveness: Scenario = {
  name: "parent-responsiveness",
  process: { managed: true },
  timeoutMs: 60_000,
  configureProvider(context) {
    if (context.role === "child") {
      context.faux.setResponses([
        async () => {
          await delay(30_000);
          return fauxAssistantMessage(fauxText("Performance child released."));
        },
      ]);
      return;
    }

    const launches = Array.from({ length: CHILD_COUNT }, (_, index) =>
      fauxToolCall("Agent", {
        description: `performance child ${index + 1}`,
        interactive: true,
        prompt: `Stay active as performance child ${index + 1}.`,
      }),
    );

    context.faux.setResponses([
      fauxAssistantMessage(launches, { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxText("All performance children launched.")),
    ]);
  },
  async run(harness: E2EHarness) {
    const baseline = await medianInputLatency(harness, "baseline");
    await harness.sendParentKeys("C-u");
    await harness.sendParent("Launch all performance children.", true);
    await harness.waitFor("All performance children launched.", 20_000);
    await harness.waitUntil(
      `${CHILD_COUNT} managed child panes`,
      async () => (await harness.childPanes()).length === CHILD_COUNT,
      20_000,
    );
    await harness.waitFor(`${CHILD_COUNT} live`, 10_000);

    const loaded = await medianInputLatency(harness, "loaded");
    const added = loaded - baseline;
    await harness.sendParentKeys("C-u");
    const navigation = await medianNavigationLatency(harness);

    harness.assert(
      added <= MAX_ADDED_INPUT_LATENCY_MS,
      `Active children added ${added.toFixed(1)}ms parent input latency ` +
        `(baseline ${baseline.toFixed(1)}ms, loaded ${loaded.toFixed(1)}ms).`,
    );
    harness.assert(
      navigation <= loaded + 15,
      `Widget navigation took ${navigation.toFixed(1)}ms versus ` +
        `${loaded.toFixed(1)}ms loaded input latency.`,
    );
  },
};
