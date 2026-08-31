/**
 * Let Pi's hardware terminal cursor remain visible by removing the inverse-video
 * style from the editor's software cursor.
 *
 * Requires `showHardwareCursor: true` in Pi settings.
 */

import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER } from "@earendil-works/pi-tui";

const PATCH_STATE = Symbol.for("blinking-cursor.editor-render.patch");
const UI_PATCH_STATE = Symbol.for("blinking-cursor.editor-component.patch");
const INVERSE_VIDEO = "\x1b[7m";
const BLINKING_BLOCK_CURSOR = "\x1b[1 q";
const DEFAULT_CURSOR = "\x1b[0 q";
const SHOW_CURSOR = "\x1b[?25h";
const HIDE_CURSOR = "\x1b[?25l";
const ENABLE_FOCUS_REPORTING = "\x1b[?1004h";
const DISABLE_FOCUS_REPORTING = "\x1b[?1004l";
const FOCUS_EVENT_PATTERN = /\x1b\[([IO])/g;

type EditorRender = (width: number) => string[];
type EditorFactory = NonNullable<
  ReturnType<ExtensionUIContext["getEditorComponent"]>
>;
type CursorTUI = Parameters<EditorFactory>[0] & { showHardwareCursor: boolean };
type RegisterCursorTUI = (tui: CursorTUI) => void;

type PatchableEditor = {
  render: EditorRender;
  [PATCH_STATE]?: { originalRender: EditorRender };
};

type SetEditorComponent = (factory: EditorFactory | undefined) => void;

type PatchableEditorUI = {
  getEditorComponent(): EditorFactory | undefined;
  setEditorComponent: SetEditorComponent;
  [UI_PATCH_STATE]?: {
    originalSetEditorComponent: SetEditorComponent;
    patchedSetEditorComponent: SetEditorComponent;
  };
};

function removeSoftwareCursor(line: string): string {
  const markerIndex = line.indexOf(CURSOR_MARKER);
  if (markerIndex < 0) return line;

  const styleIndex = markerIndex + CURSOR_MARKER.length;
  if (!line.startsWith(INVERSE_VIDEO, styleIndex)) return line;

  return (
    line.slice(0, styleIndex) + line.slice(styleIndex + INVERSE_VIDEO.length)
  );
}

function patchEditorRender(target: PatchableEditor): void {
  if (target[PATCH_STATE]) return;

  const originalRender = target.render;
  if (typeof originalRender !== "function") {
    throw new Error("editor.render not found");
  }

  target[PATCH_STATE] = { originalRender };
  target.render = function blinkingCursorRender(width: number): string[] {
    return originalRender.call(this, width).map(removeSoftwareCursor);
  };
}

function wrapEditorFactory(
  factory: EditorFactory | undefined,
  registerTUI: RegisterCursorTUI,
): EditorFactory {
  return (tui, theme, keybindings) => {
    registerTUI(tui as CursorTUI);
    const editor = factory
      ? factory(tui, theme, keybindings)
      : new CustomEditor(tui, theme, keybindings);
    patchEditorRender(editor as PatchableEditor);
    return editor;
  };
}

function installEditorComponentPatch(
  ui: PatchableEditorUI,
  registerTUI: RegisterCursorTUI,
): void {
  if (ui[UI_PATCH_STATE]) return;

  const originalSetEditorComponent = ui.setEditorComponent.bind(ui);
  const patchedSetEditorComponent: SetEditorComponent = (factory) => {
    originalSetEditorComponent(wrapEditorFactory(factory, registerTUI));
  };

  ui[UI_PATCH_STATE] = {
    originalSetEditorComponent,
    patchedSetEditorComponent,
  };
  ui.setEditorComponent = patchedSetEditorComponent;
  patchedSetEditorComponent(ui.getEditorComponent());
}

function removeEditorComponentPatch(ui: PatchableEditorUI): void {
  const state = ui[UI_PATCH_STATE];
  if (!state) return;

  if (ui.setEditorComponent === state.patchedSetEditorComponent) {
    ui.setEditorComponent = state.originalSetEditorComponent;
  }
  delete ui[UI_PATCH_STATE];
}

export default function blinkingCursor(pi: ExtensionAPI): void {
  let cursorControlsEnabled = false;
  let terminalFocused = true;
  let focusInputRemainder = "";
  let patchedUI: PatchableEditorUI | undefined;
  const cursorTuis = new Set<CursorTUI>();

  const setTerminalFocused = (focused: boolean) => {
    if (terminalFocused === focused) return;
    terminalFocused = focused;

    for (const tui of cursorTuis) {
      // The public setter requests a full repaint. Update the same state
      // directly so later renders honor focus without delaying pane switches.
      tui.showHardwareCursor = focused;
    }
    process.stdout.write(focused ? SHOW_CURSOR : HIDE_CURSOR);
  };

  const registerTUI: RegisterCursorTUI = (tui) => {
    cursorTuis.add(tui);
    tui.showHardwareCursor = terminalFocused;
  };

  const handleTerminalInput = (data: Buffer | string) => {
    const input = focusInputRemainder + data.toString();
    focusInputRemainder = input.endsWith("\x1b[")
      ? "\x1b["
      : input.endsWith("\x1b")
        ? "\x1b"
        : "";

    FOCUS_EVENT_PATTERN.lastIndex = 0;
    for (
      let match = FOCUS_EVENT_PATTERN.exec(input);
      match;
      match = FOCUS_EVENT_PATTERN.exec(input)
    ) {
      setTerminalFocused(match[1] === "I");
    }
  };

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    try {
      patchedUI = ctx.ui as PatchableEditorUI;
      installEditorComponentPatch(patchedUI, registerTUI);

      // Focus reporting gives both tmux pane focus and terminal window focus.
      process.stdin.on("data", handleTerminalInput);
      process.stdout.write(
        ENABLE_FOCUS_REPORTING + BLINKING_BLOCK_CURSOR + SHOW_CURSOR,
      );
      cursorControlsEnabled = true;
    } catch (error) {
      console.error("blinking-cursor: failed to patch editor", error);
    }
  });

  pi.on("session_shutdown", () => {
    if (patchedUI) {
      removeEditorComponentPatch(patchedUI);
      patchedUI = undefined;
    }
    process.stdin.removeListener("data", handleTerminalInput);
    cursorTuis.clear();
    focusInputRemainder = "";
    terminalFocused = true;
    if (!cursorControlsEnabled) return;
    process.stdout.write(
      DISABLE_FOCUS_REPORTING + DEFAULT_CURSOR + SHOW_CURSOR,
    );
    cursorControlsEnabled = false;
  });
}
