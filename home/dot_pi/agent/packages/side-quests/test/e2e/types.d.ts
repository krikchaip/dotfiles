import type { registerFauxProvider } from "@earendil-works/pi-ai/compat";

import type { E2EHarness as Harness } from "./harness.ts";

declare global {
  type E2EHarness = Harness;
  type Faux = ReturnType<typeof registerFauxProvider>;

  interface ProviderContext {
    readonly faux: Faux;
    readonly initialPrompt: string;
    readonly role: "child" | "parent";
  }

  interface ScenarioProcess {
    readonly child?: boolean;
    readonly lifecycle?: "interactive";
    readonly managed?: boolean;
    readonly outsideTmux?: boolean;
    readonly positionalPrompt?: string;
    readonly settings?: Readonly<Record<string, unknown>>;
  }

  interface Scenario {
    readonly name: string;
    readonly process: ScenarioProcess;
    readonly timeoutMs?: number;
    readonly width?: number;
    configureProvider?(context: ProviderContext): void;
    run(harness: E2EHarness): Promise<void>;
  }
}
