import {
  type Theme,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

type RendererOwner = { toolName?: unknown };
type RendererGetter = (this: RendererOwner) => unknown;
type MutablePrototype = Record<PropertyKey, unknown>;

/**
 * Reproduces a host compositor that loads after Side Quests. Its Agent
 * renderer keeps the first complete summary, as cc-tools does.
 */
export default function installDelegatingToolRenderer(): void {
  const prototype =
    ToolExecutionComponent.prototype as unknown as MutablePrototype;
  const delegatedGetCallRenderer = prototype.getCallRenderer as RendererGetter;

  prototype.getCallRenderer = function getDelegatedCallRenderer(
    this: RendererOwner,
  ): unknown {
    if (this.toolName !== "Agent") return delegatedGetCallRenderer.call(this);

    return (args: unknown, theme: Theme, context: unknown) => {
      const display = args as { description?: string };
      const renderContext = context as {
        argsComplete?: boolean;
        isPartial?: boolean;
        state: {
          fixtureAgentSummary?: string;
          fixtureAgentSummaryComplete?: boolean;
        };
      };
      const state = renderContext.state;
      const stable =
        renderContext.argsComplete === true &&
        state.fixtureAgentSummaryComplete === true &&
        typeof state.fixtureAgentSummary === "string";

      if (!stable) {
        state.fixtureAgentSummary = display.description;
        if (renderContext.argsComplete === true)
          state.fixtureAgentSummaryComplete = true;
        else state.fixtureAgentSummaryComplete = undefined;
      }

      const color = renderContext.isPartial ? "dim" : "success";

      return new Text(
        `${theme.fg(color, "●")} Agent ${state.fixtureAgentSummary}`,
        0,
        0,
      );
    };
  };
}
