import { appendFileSync } from "node:fs";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import {
  InteractiveMode,
  ModelSelectorComponent,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

const PROVIDER = "selector-e2e";
const MODEL_IDS = ["probe-alpha", "probe-beta", "probe-delta", "probe-gamma"];
const REGULAR_PATCH = Symbol.for("model-selector-e2e.regular-probe");
const SCOPED_PATCH = Symbol.for("model-selector-e2e.scoped-probe");

type Selector = {
  constructor?: { name?: string };
  searchInput?: { getValue(): string };
  selectedIndex?: number;
  handleInput(data: unknown): void;
};

function record(
  path: string,
  selector: Selector,
  selectedBefore: number | undefined,
  searchBefore: string | undefined,
): void {
  const searchAfter = selector.searchInput?.getValue();
  if (searchBefore === searchAfter) return;
  appendFileSync(
    path,
    `${JSON.stringify({
      component: selector.constructor?.name,
      searchBefore,
      searchAfter,
      selectedBefore,
      selectedAfter: selector.selectedIndex,
    })}\n`,
  );
}

function patchSelector(
  path: string,
  selector: Selector,
  marker: typeof REGULAR_PATCH | typeof SCOPED_PATCH,
): void {
  const patchable = selector as Selector & Record<symbol, boolean | undefined>;
  if (patchable[marker]) return;
  patchable[marker] = true;

  const originalHandleInput = selector.handleInput;
  selector.handleInput = function observedHandleInput(this: Selector, data: unknown): void {
    const selectedBefore = this.selectedIndex;
    const searchBefore = this.searchInput?.getValue();
    originalHandleInput.call(this, data);
    queueMicrotask(() => record(path, this, selectedBefore, searchBefore));
  };
}

export default function modelSelectorProbe(pi: ExtensionAPI): void {
  const path = process.env.PI_E2E_MODEL_CURSOR_CAPTURE;
  if (!path) throw new Error("PI_E2E_MODEL_CURSOR_CAPTURE is required.");

  const faux = registerFauxProvider({
    provider: PROVIDER,
    models: MODEL_IDS.map((id) => ({ id, reasoning: false })),
  });
  pi.registerProvider(PROVIDER, {
    name: "Model Selector E2E",
    baseUrl: `faux://${PROVIDER}`,
    apiKey: "test",
    api: faux.api,
    models: MODEL_IDS.map((id) => ({
      id,
      name: id,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8_192,
      maxTokens: 256,
    })),
  });

  patchSelector(
    path,
    ModelSelectorComponent.prototype as unknown as Selector,
    REGULAR_PATCH,
  );

  const interactive = InteractiveMode.prototype as unknown as {
    showSelector(
      factory: (done: () => void) => { component: Selector; focus: unknown },
    ): unknown;
  } & Record<symbol, boolean | undefined>;
  if (!interactive[SCOPED_PATCH]) {
    interactive[SCOPED_PATCH] = true;
    const originalShowSelector = interactive.showSelector;
    interactive.showSelector = function observedShowSelector(
      factory: (done: () => void) => { component: Selector; focus: unknown },
    ): unknown {
      return originalShowSelector.call(this, (done: () => void) => {
        const result = factory(done);
        if (result?.component?.constructor?.name === "ScopedModelsSelectorComponent") {
          patchSelector(path, result.component, SCOPED_PATCH);
        }
        return result;
      });
    };
  }

  pi.on("session_start", (_event, context) => {
    if (context.mode === "tui") {
      context.ui.setWidget("model-selector-e2e", ["MODEL CURSOR PROBE READY"]);
    }
  });
}
