import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import { type Component, Spacer } from "@earendil-works/pi-tui";

export const PARENT_WIDGET_ID = "side-quests";
export const CHILD_WIDGET_ID = "side-quests-child";

const PATCH_STATE = Symbol.for("side-quests.widget-stack-spacing");
const WIDGET_IDS = new Set([PARENT_WIDGET_ID, CHILD_WIDGET_ID]);

type RenderWidgetContainer = (
  container: unknown,
  widgets: Map<string, unknown>,
  spacerWhenEmpty: boolean,
  leadingSpacer: boolean,
) => void;

type PatchablePrototype = {
  renderWidgetContainer?: RenderWidgetContainer;
} & Record<symbol, RenderWidgetContainer | undefined>;

type WidgetContainer = {
  children: Component[];
};

/**
 * Renders earlier widgets and conditionally separates a top Side Quests widget.
 */
class ConditionalTopMargin implements Component {
  constructor(
    private readonly earlier: readonly Component[],
    private readonly sideQuest: Component,
  ) {}

  render(width: number): string[] {
    const earlierLines = this.earlier.flatMap((component) =>
      component.render(width),
    );
    const sideQuestLines = this.sideQuest.render(width);

    if (sideQuestLines.length === 0) return earlierLines;
    if (earlierLines.length > 0) return [...earlierLines, ...sideQuestLines];

    return ["", ...sideQuestLines];
  }

  invalidate(): void {
    for (const component of [...this.earlier, this.sideQuest])
      component.invalidate();
  }
}

/**
 * Restores a margin only when Side Quests is the first visible above-editor widget.
 */
export class WidgetStackSpacing {
  static install(prototype: object = InteractiveMode.prototype): void {
    const patchable = prototype as PatchablePrototype;
    if (patchable[PATCH_STATE]) return;

    const original = patchable.renderWidgetContainer;
    if (!original) return;

    patchable[PATCH_STATE] = original;
    patchable.renderWidgetContainer = function renderWithSideQuestSpacing(
      container,
      widgets,
      spacerWhenEmpty,
      leadingSpacer,
    ): void {
      original.call(this, container, widgets, spacerWhenEmpty, leadingSpacer);

      if (!WidgetStackSpacing.isWidgetContainer(container)) return;
      if (container.children[0] instanceof Spacer) return;

      const sideQuest = WidgetStackSpacing.sideQuestComponent(widgets);
      if (!sideQuest) return;

      const index = container.children.indexOf(sideQuest);
      if (index < 0) return;

      const grouped = container.children.splice(0, index + 1);
      const target = grouped.pop();
      if (!target) return;

      container.children.unshift(new ConditionalTopMargin(grouped, target));
    };
  }

  private constructor() {}

  private static sideQuestComponent(
    widgets: ReadonlyMap<string, unknown>,
  ): Component | undefined {
    for (const id of WIDGET_IDS) {
      const component = widgets.get(id);
      if (WidgetStackSpacing.isComponent(component)) return component;
    }

    return undefined;
  }

  private static isComponent(value: unknown): value is Component {
    return (
      typeof value === "object" &&
      value !== null &&
      typeof (value as Partial<Component>).render === "function" &&
      typeof (value as Partial<Component>).invalidate === "function"
    );
  }

  private static isWidgetContainer(value: unknown): value is WidgetContainer {
    return (
      typeof value === "object" &&
      value !== null &&
      Array.isArray((value as Partial<WidgetContainer>).children)
    );
  }
}
