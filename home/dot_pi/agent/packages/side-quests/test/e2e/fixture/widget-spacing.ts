import {
  type ExtensionAPI,
  InteractiveMode,
} from "@earendil-works/pi-coding-agent";

const HIDDEN_WIDGET_ID = "spacing-hidden-session-title";
const SPACING_PATCH = Symbol.for("side-quests-e2e.widget-spacing-patch");

type RenderWidgetContainer = (
  container: unknown,
  widgets: Map<string, unknown>,
  spacerWhenEmpty: boolean,
  leadingSpacer: boolean,
) => void;

type PatchablePrototype = {
  renderWidgetContainer?: RenderWidgetContainer;
} & Record<symbol, RenderWidgetContainer | undefined>;

/** Reproduces Powerline's leading-spacer suppression with one hidden widget. */
function installSuppressionPatch(): void {
  const prototype = InteractiveMode.prototype as unknown as PatchablePrototype;
  if (prototype[SPACING_PATCH]) return;

  const original = prototype.renderWidgetContainer;
  if (!original)
    throw new Error("InteractiveMode widget rendering is missing.");

  prototype[SPACING_PATCH] = original;
  prototype.renderWidgetContainer = function suppressLeadingSpacer(
    container,
    widgets,
    spacerWhenEmpty,
    leadingSpacer,
  ): void {
    original.call(
      this,
      container,
      widgets,
      spacerWhenEmpty,
      leadingSpacer && !widgets.has(HIDDEN_WIDGET_ID),
    );
  };
}

/** Reproduces the real plugin stack that removes Pi's generic top margin. */
export default function registerWidgetSpacingFixture(pi: ExtensionAPI): void {
  installSuppressionPatch();

  pi.on("session_start", (_event, context) => {
    if (context.mode !== "tui") return;

    context.ui.setWidget(HIDDEN_WIDGET_ID, [], { placement: "aboveEditor" });
  });
}
