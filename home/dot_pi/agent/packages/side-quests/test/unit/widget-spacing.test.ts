import { type Component, Container, Spacer } from "@earendil-works/pi-tui";
import { expect, test } from "vitest";

import {
  CHILD_WIDGET_ID,
  PARENT_WIDGET_ID,
  WidgetStackSpacing,
} from "../../renderer/widget-spacing.ts";

const HIDDEN_WIDGET_ID = "hidden-session-title";

type RenderWidgetContainer = (
  container: Container,
  widgets: Map<string, Component>,
  spacerWhenEmpty: boolean,
  leadingSpacer: boolean,
) => void;

function component(lines: readonly string[]): Component {
  return {
    invalidate() {},
    render: () => [...lines],
  };
}

function makePrototype(suppressLeadingSpacer: boolean): {
  renderWidgetContainer: RenderWidgetContainer;
} {
  return {
    renderWidgetContainer(container, widgets, spacerWhenEmpty, leadingSpacer) {
      container.clear();
      if (widgets.size === 0) {
        if (spacerWhenEmpty) container.addChild(new Spacer(1));
        return;
      }

      if (
        leadingSpacer &&
        !(suppressLeadingSpacer && widgets.has(HIDDEN_WIDGET_ID))
      )
        container.addChild(new Spacer(1));

      for (const widget of widgets.values()) container.addChild(widget);
    },
  };
}

function render(
  prototype: { renderWidgetContainer: RenderWidgetContainer },
  widgets: Map<string, Component>,
): string[] {
  const container = new Container();
  prototype.renderWidgetContainer(container, widgets, true, true);
  return container.render(80);
}

test.each([PARENT_WIDGET_ID, CHILD_WIDGET_ID])(
  "restores one stack margin for %s after another extension suppresses it",
  (widgetId) => {
    const prototype = makePrototype(true);
    WidgetStackSpacing.install(prototype);

    expect(
      render(
        prototype,
        new Map([
          [HIDDEN_WIDGET_ID, component([])],
          [widgetId, component(["Side Quests"])],
        ]),
      ),
    ).toEqual(["", "Side Quests"]);
  },
);

test("does not restore a margin when another visible widget comes first", () => {
  const prototype = makePrototype(true);
  WidgetStackSpacing.install(prototype);

  expect(
    render(
      prototype,
      new Map([
        [HIDDEN_WIDGET_ID, component([])],
        ["visible-widget", component(["Other extension"])],
        [PARENT_WIDGET_ID, component(["Side Quests"])],
      ]),
    ),
  ).toEqual(["Other extension", "Side Quests"]);
});

test("does not duplicate Pi's native stack margin", () => {
  const prototype = makePrototype(false);
  WidgetStackSpacing.install(prototype);

  expect(
    render(
      prototype,
      new Map([[PARENT_WIDGET_ID, component(["Side Quests"])]]),
    ),
  ).toEqual(["", "Side Quests"]);
});

test("does not change a widget stack without Side Quests", () => {
  const prototype = makePrototype(true);
  WidgetStackSpacing.install(prototype);

  expect(
    render(
      prototype,
      new Map([
        [HIDDEN_WIDGET_ID, component([])],
        ["visible-widget", component(["Other extension"])],
      ]),
    ),
  ).toEqual(["Other extension"]);
});
