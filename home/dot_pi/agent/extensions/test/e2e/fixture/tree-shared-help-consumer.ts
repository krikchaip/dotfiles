import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

const HELP_HINTS = Symbol.for("pi:tree-help-hints");
const HELP_HINTS_CONSUMED = Symbol.for("pi:tree-help-hints-consumed");
const PATCHED = Symbol.for("pi-e2e:tree-shared-help-consumer");

export default function treeSharedHelpConsumer(_pi: ExtensionAPI): void {
  const prototype = InteractiveMode.prototype as any;
  if (prototype[PATCHED]) return;

  const originalShowTreeSelector = prototype.showTreeSelector;
  prototype.showTreeSelector = function (...args: unknown[]) {
    const originalShowSelector = this.showSelector;
    this.showSelector = function (factory: (done: () => void) => any) {
      return originalShowSelector.call(this, (done: () => void) => {
        const result = factory(done);
        const selector = result?.component;
        if (selector?.render) {
          const originalRender = selector.render.bind(selector);
          selector.render = (width: number): string[] => {
            const lines = originalRender(width);
            const hints = Array.isArray(selector[HELP_HINTS])
              ? selector[HELP_HINTS]
              : [];
            if (hints.length > 0) {
              selector[HELP_HINTS_CONSUMED] = true;
              const text = `  ${hints
                .map(
                  (hint: { key: string; label: string }) =>
                    `${hint.key} ${hint.label}`,
                )
                .join(" · ")}`;
              const searchIndex = lines.findIndex((line: string) =>
                line.includes("Type to search:"),
              );
              if (
                searchIndex >= 0 &&
                !lines.some((line: string) => line.includes(text))
              ) {
                lines.splice(searchIndex, 0, truncateToWidth(text, width));
              }
            }
            return lines;
          };
        }
        return result;
      });
    };
    try {
      return originalShowTreeSelector.apply(this, args);
    } finally {
      if (Object.prototype.hasOwnProperty.call(this, "showSelector")) {
        delete this.showSelector;
      }
    }
  };
  prototype[PATCHED] = true;
}
