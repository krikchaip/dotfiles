import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface SearchInput {
  getValue(): string;
}

interface ModelSelectorThis {
  searchInput: SearchInput;
  selectedIndex: number;
  updateList(): void;
}

interface ScopedSelectorThis {
  searchInput: SearchInput;
  selectedIndex: number;
  refresh(): void;
}

interface PatchedPrototype {
  _cursorPatched?: boolean;
  handleInput(data: unknown): void;
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async () => {
    // Normal import for exported component
    const { ModelSelectorComponent } =
      await import("@earendil-works/pi-coding-agent");

    // Bypass exports map for unexported component using absolute URL
    const pkgUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
    const scopedUrl = new URL(
      "./modes/interactive/components/scoped-models-selector.js",
      pkgUrl,
    ).href;
    const { ScopedModelsSelectorComponent } = await import(scopedUrl);

    const modelProto =
      ModelSelectorComponent.prototype as unknown as PatchedPrototype;
    if (!modelProto._cursorPatched) {
      modelProto._cursorPatched = true;

      const origModelHandle = modelProto.handleInput;
      modelProto.handleInput = function (
        this: ModelSelectorThis,
        keyData: unknown,
      ) {
        const prev = this.searchInput.getValue();
        origModelHandle.call(this, keyData);
        if (this.searchInput.getValue() !== prev) {
          this.selectedIndex = 0;
          this.updateList();
        }
      };
    }

    const scopedProto =
      ScopedModelsSelectorComponent.prototype as unknown as PatchedPrototype;
    if (!scopedProto._cursorPatched) {
      scopedProto._cursorPatched = true;

      const origScopedHandle = scopedProto.handleInput;
      scopedProto.handleInput = function (
        this: ScopedSelectorThis,
        data: unknown,
      ) {
        const prev = this.searchInput.getValue();
        origScopedHandle.call(this, data);
        if (this.searchInput.getValue() !== prev) {
          this.selectedIndex = 0;
          this.refresh();
        }
      };
    }
  });
}
