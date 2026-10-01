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
    /** Test-owned project agent files created before Pi starts. */
    readonly agentDefinitions?: Readonly<Record<string, string>>;

    /** Test-owned project .agents skill files created before Pi starts. */
    readonly agentSkillFiles?: Readonly<Record<string, string>>;

    /** Additional native Pi flags for test-owned launch input. */
    readonly arguments?: readonly string[];

    readonly child?: boolean;

    /** Allows only the selected factory-failure label asserted by the scenario. */
    readonly expectedExtensionFactoryFailure?: boolean;

    readonly extensionFixtures?: readonly string[];
    readonly extensionsBefore?: readonly string[];

    /** Test-owned global agent files created before Pi starts. */
    readonly globalAgentDefinitions?: Readonly<Record<string, string>>;

    /** Load the deterministic E2E provider without requiring a managed child. */
    readonly fauxProvider?: boolean;

    readonly lifecycle?: "interactive";
    readonly managed?: boolean;

    /** Override resource offline mode for test-owned loopback package fixtures. */
    readonly offline?: boolean;

    /** Reduces parent extension discovery while retaining the explicit provider. */
    readonly noExtensions?: boolean;

    readonly outsideTmux?: boolean;
    readonly persistSession?: boolean;
    readonly positionalPrompt?: string;
    readonly providerTokensPerSecond?: number;

    /** Lowers the production Package budget for a test-owned real launch. */
    readonly resourceBudgetBytes?: number;
    readonly settings?: Readonly<Record<string, unknown>>;

    /** Test-owned global skill files created before Pi starts. */
    readonly skillFiles?: Readonly<Record<string, string>>;

    readonly terminalForegroundResponse?: string;
    readonly themeFixture?: string;
    readonly tmuxFixture?: string;
  }

  interface Scenario {
    readonly name: string;
    readonly exclusive?: boolean;
    readonly process: ScenarioProcess;
    readonly timeoutMs?: number;
    readonly width?: number;
    /** Prepares test-owned resources before native Pi startup. */
    prepare?(harness: E2EHarness): Promise<void>;
    configureProvider?(context: ProviderContext): void;
    run(harness: E2EHarness): Promise<void>;
  }
}
