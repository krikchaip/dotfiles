/**
 * Patches ModelSelectorComponent and ScopedModelsSelectorComponent to reset
 * selectedIndex to 0 whenever search input text changes.
 */

import {
  InteractiveMode,
  ModelSelectorComponent,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

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

function patchModelPrototype(proto: PatchedPrototype) {
  if (proto._cursorPatched) return;
  proto._cursorPatched = true;

  const originalHandleInput = proto.handleInput;
  proto.handleInput = function (this: ModelSelectorThis, data: unknown) {
    const previous = this.searchInput.getValue();
    originalHandleInput.call(this, data);
    if (this.searchInput.getValue() !== previous) {
      this.selectedIndex = 0;
      this.updateList();
    }
  };
}

function patchScopedPrototype(proto: PatchedPrototype) {
  if (proto._cursorPatched) return;
  proto._cursorPatched = true;

  const originalHandleInput = proto.handleInput;
  proto.handleInput = function (this: ScopedSelectorThis, data: unknown) {
    const previous = this.searchInput.getValue();
    originalHandleInput.call(this, data);
    if (this.searchInput.getValue() !== previous) {
      this.selectedIndex = 0;
      this.refresh();
    }
  };
}

export default function (_pi: ExtensionAPI) {
  patchModelPrototype(
    ModelSelectorComponent.prototype as unknown as PatchedPrototype,
  );

  const interactiveProto = InteractiveMode.prototype as any;
  if (interactiveProto.__scopedModelCursorAdapterPatched) return;
  interactiveProto.__scopedModelCursorAdapterPatched = true;

  const originalShowSelector = interactiveProto.showSelector;
  interactiveProto.showSelector = function (
    factory: (done: () => void) => { component: any; focus: any },
  ) {
    return originalShowSelector.call(this, (done: () => void) => {
      const result = factory(done);
      const component = result?.component;
      if (
        component?.constructor?.name === "ScopedModelsSelectorComponent" &&
        typeof component.handleInput === "function"
      ) {
        patchScopedPrototype(Object.getPrototypeOf(component));
      }
      return result;
    });
  };
}
