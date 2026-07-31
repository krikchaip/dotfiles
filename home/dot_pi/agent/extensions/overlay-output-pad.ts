/**
 * Makes outputPad a horizontal viewport inset while TUI overlays are visible.
 *
 * Pi TUI overlays otherwise compose against the full terminal width. This
 * temporarily removes the outer gutter used by fixed-editor compositors.
 */

import {
  getAgentDir,
  SettingsManager,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
  TUI,
  truncateToWidth,
  type Component,
  type OverlayHandle,
  type OverlayOptions,
} from "@earendil-works/pi-tui";

const PROTOTYPE_PATCH = "__overlayOutputPadPrototypePatch";
const INSTANCE_PATCH = "__overlayOutputPadInstancePatch";

type CompositeOverlays = (
  lines: string[],
  width: number,
  height: number,
) => string[];

type ShowOverlay = (
  component: Component,
  options?: OverlayOptions,
) => OverlayHandle;

type PrototypePatchState = {
  generation: number;
  outputPad: number;
  originalShowOverlay: ShowOverlay;
};

type InstancePatchState = {
  generation: number;
  patchedCompositeOverlays: CompositeOverlays;
  patchedRender: (width: number) => string[];
};

// Pi keeps compositeOverlays private. Use only the narrow runtime shape this
// compatibility patch needs, rather than intersecting TUI with a private field.
type TuiInternals = {
  [INSTANCE_PATCH]?: InstancePatchState;
  compositeOverlays: CompositeOverlays;
  hasOverlay(): boolean;
  render(width: number): string[];
};

type TuiPrototype = {
  [PROTOTYPE_PATCH]?: PrototypePatchState;
  showOverlay: ShowOverlay;
};

function outerPadding(width: number, outputPad: number): number {
  return Math.min(outputPad, Math.max(0, Math.floor((width - 1) / 2)));
}

function innerWidth(width: number, outputPad: number): number {
  return Math.max(1, width - outerPadding(width, outputPad) * 2);
}

function insetLine(line: string, width: number, outputPad: number): string {
  const padding = outerPadding(width, outputPad);
  if (padding === 0) return truncateToWidth(line, width);

  const contentWidth = innerWidth(width, outputPad);
  return `${" ".repeat(padding)}${truncateToWidth(line, contentWidth)}${" ".repeat(padding)}`;
}

function patchTuiInstance(
  tui: TuiInternals,
  prototypeState: PrototypePatchState,
): void {
  const current = tui[INSTANCE_PATCH];
  if (current?.generation === prototypeState.generation) return;

  const compositeOverlays = tui.compositeOverlays;
  if (typeof compositeOverlays !== "function") return;

  const renderStillPatched =
    current !== undefined && tui.render === current.patchedRender;
  const compositeStillPatched =
    current !== undefined &&
    tui.compositeOverlays === current.patchedCompositeOverlays;

  let patchedRender: (width: number) => string[];
  if (renderStillPatched) {
    patchedRender = current!.patchedRender;
  } else {
    const originalRender = tui.render.bind(tui);
    patchedRender = (width: number): string[] => {
      const outputPad = prototypeState.outputPad;
      if (outputPad === 0 || !tui.hasOverlay()) return originalRender(width);
      return originalRender(innerWidth(width, outputPad));
    };
    tui.render = patchedRender;
  }

  let patchedCompositeOverlays: CompositeOverlays;
  if (compositeStillPatched) {
    patchedCompositeOverlays = current!.patchedCompositeOverlays;
  } else {
    const originalCompositeOverlays = compositeOverlays.bind(tui);
    patchedCompositeOverlays = (
      lines: string[],
      width: number,
      height: number,
    ): string[] => {
      const outputPad = prototypeState.outputPad;
      if (outputPad === 0) {
        return originalCompositeOverlays(lines, width, height);
      }

      return originalCompositeOverlays(
        lines,
        innerWidth(width, outputPad),
        height,
      ).map((line: string) => insetLine(line, width, outputPad));
    };
    tui.compositeOverlays = patchedCompositeOverlays;
  }
  tui[INSTANCE_PATCH] = {
    generation: prototypeState.generation,
    patchedCompositeOverlays,
    patchedRender,
  };
}

function installPrototypePatch(outputPad: number): void {
  const prototype = TUI.prototype as unknown as TuiPrototype;
  const current = prototype[PROTOTYPE_PATCH];
  if (current) {
    current.generation += 1;
    current.outputPad = outputPad;
    return;
  }

  const originalShowOverlay = prototype.showOverlay;
  const state: PrototypePatchState = {
    generation: 1,
    outputPad,
    originalShowOverlay,
  };
  prototype[PROTOTYPE_PATCH] = state;

  prototype.showOverlay = function patchedShowOverlay(
    this: TuiInternals,
    component: Component,
    options?: OverlayOptions,
  ): OverlayHandle {
    patchTuiInstance(this as unknown as TuiInternals, state);
    return state.originalShowOverlay.call(this, component, options);
  };
}

export default function overlayOutputPad(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
      projectTrusted: ctx.isProjectTrusted(),
    });
    installPrototypePatch(settings.getOutputPad());
  });
}
