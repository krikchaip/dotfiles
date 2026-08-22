import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";

type RendererOwner = { toolName?: unknown };
type RendererGetter = (this: RendererOwner) => unknown;
type MutablePrototype = Record<PropertyKey, unknown>;

/**
 * Reproduces a host compositor that loads after Side Quests and delegates
 * registered tool renderers back to the earlier adapter.
 */
export default function installDelegatingToolRenderer(): void {
  const prototype =
    ToolExecutionComponent.prototype as unknown as MutablePrototype;
  const delegatedGetCallRenderer = prototype.getCallRenderer as RendererGetter;

  prototype.getCallRenderer = function getDelegatedCallRenderer(
    this: RendererOwner,
  ): unknown {
    return delegatedGetCallRenderer.call(this);
  };
}
