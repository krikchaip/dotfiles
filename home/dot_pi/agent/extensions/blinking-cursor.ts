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
import { CURSOR_MARKER, type Terminal } from "@earendil-works/pi-tui";

const PATCH_STATE = Symbol.for("blinking-cursor.editor-render.patch");
const UI_PATCH_STATE = Symbol.for("blinking-cursor.editor-component.patch");
const TERMINAL_PATCH_STATE = Symbol.for("blinking-cursor.terminal-write.patch");
const INVERSE_VIDEO = "\x1b[7m";
const BLINKING_BLOCK_CURSOR = "\x1b[1 q";
const DEFAULT_CURSOR = "\x1b[0 q";
const SHOW_CURSOR = "\x1b[?25h";
const HIDE_CURSOR = "\x1b[?25l";
const ENABLE_FOCUS_REPORTING = "\x1b[?1004h";
const DISABLE_FOCUS_REPORTING = "\x1b[?1004l";
const BEGIN_SYNCHRONIZED_OUTPUT = "\x1b[?2026h";
const FOCUS_EVENT_PATTERN = /\x1b\[([IO])/g;

type EditorRender = (width: number) => string[];
type EditorFactory = NonNullable<
  ReturnType<ExtensionUIContext["getEditorComponent"]>
>;
type TerminalWrite = Terminal["write"];
type TerminalPatchState = {
  originalWrite: TerminalWrite;
  patchedWrite: TerminalWrite;
  renderRequestedCursor: boolean;
};
type PatchableTerminal = Pick<Terminal, "write"> & {
  [TERMINAL_PATCH_STATE]?: TerminalPatchState;
};
type CursorTUI = Parameters<EditorFactory>[0] & {
  showHardwareCursor: boolean;
  terminal: PatchableTerminal;
};
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

/**
 * Removes the inverse-video software cursor style from one rendered editor row.
 *
 * @param line - A rendered editor row that can contain Pi's cursor marker.
 * @returns The row without inverse video after the marker.
 */
function removeSoftwareCursor(line: string): string {
  const markerIndex = line.indexOf(CURSOR_MARKER);
  if (markerIndex < 0) return line;

  const styleIndex = markerIndex + CURSOR_MARKER.length;
  if (!line.startsWith(INVERSE_VIDEO, styleIndex)) return line;

  return (
    line.slice(0, styleIndex) + line.slice(styleIndex + INVERSE_VIDEO.length)
  );
}

/**
 * Patches an editor so its rendered cursor uses only the hardware cursor.
 *
 * @param target - The editor instance to patch once.
 */
function patchEditorRender(target: PatchableEditor): void {
  if (target[PATCH_STATE]) return;

  const originalRender = target.render;
  if (typeof originalRender !== "function") {
    throw new Error("editor.render not found");
  }

  /**
   * Renders editor rows and removes the software cursor style from each row.
   *
   * @param width - The available render width in terminal columns.
   * @returns The rendered editor rows.
   */
  const patchedRender: EditorRender = function blinkingCursorRender(
    this: PatchableEditor,
    width: number,
  ): string[] {
    return originalRender.call(this, width).map(removeSoftwareCursor);
  };

  target[PATCH_STATE] = { originalRender };
  target.render = patchedRender;
}

/**
 * Inserts a cursor-hide command at the start of each synchronized repaint.
 *
 * @param data - Terminal output that can contain synchronized repaint frames.
 * @returns Terminal output that hides the cursor before each repaint.
 */
function hideCursorBeforeSynchronizedRepaints(data: string): string {
  if (!data.includes(BEGIN_SYNCHRONIZED_OUTPUT)) return data;

  let output = "";
  let sourceIndex = 0;
  for (
    let syncIndex = data.indexOf(BEGIN_SYNCHRONIZED_OUTPUT);
    syncIndex >= 0;
    syncIndex = data.indexOf(BEGIN_SYNCHRONIZED_OUTPUT, sourceIndex)
  ) {
    const repaintIndex = syncIndex + BEGIN_SYNCHRONIZED_OUTPUT.length;
    output += data.slice(sourceIndex, repaintIndex);
    if (!data.startsWith(HIDE_CURSOR, repaintIndex)) {
      output += HIDE_CURSOR;
    }
    sourceIndex = repaintIndex;
  }
  return output + data.slice(sourceIndex);
}

/**
 * Reads the final hardware cursor request from one terminal output write.
 *
 * @param data - Terminal output that can contain cursor commands.
 * @returns The requested visibility, or `undefined` when no request exists.
 */
function requestedCursorVisibility(data: string): boolean | undefined {
  const showIndex = data.lastIndexOf(SHOW_CURSOR);
  const hideIndex = data.lastIndexOf(HIDE_CURSOR);
  if (showIndex < 0 && hideIndex < 0) return undefined;
  return showIndex > hideIndex;
}

/**
 * Patches terminal writes to preserve safe cursor state during focus and repaint.
 *
 * @param terminal - The terminal instance to patch once.
 * @param isTerminalFocused - Reports whether the terminal currently has focus.
 */
function patchTerminalWrite(
  terminal: PatchableTerminal,
  isTerminalFocused: () => boolean,
): void {
  if (terminal[TERMINAL_PATCH_STATE]) return;

  const originalWrite = terminal.write;
  let state: TerminalPatchState;

  /**
   * Records Pi's cursor request and writes output with focus-safe cursor commands.
   *
   * @param data - The terminal output from Pi.
   */
  const patchedWrite: TerminalWrite = function cursorSafeWrite(
    this: PatchableTerminal,
    data,
  ) {
    const requestedVisibility = requestedCursorVisibility(data);
    if (requestedVisibility !== undefined) {
      state.renderRequestedCursor = requestedVisibility;
    }

    let output = hideCursorBeforeSynchronizedRepaints(data);
    if (!isTerminalFocused()) {
      output = output.replaceAll(SHOW_CURSOR, HIDE_CURSOR);
    }
    originalWrite.call(this, output);
  };
  state = {
    originalWrite,
    patchedWrite,
    renderRequestedCursor: true,
  };
  terminal[TERMINAL_PATCH_STATE] = state;
  terminal.write = patchedWrite;
}

/**
 * Restores the original terminal write function when this patch still owns it.
 *
 * @param terminal - The terminal instance that can contain the patch.
 */
function removeTerminalWritePatch(terminal: PatchableTerminal): void {
  const state = terminal[TERMINAL_PATCH_STATE];
  if (!state) return;

  if (terminal.write === state.patchedWrite) {
    terminal.write = state.originalWrite;
  }
  delete terminal[TERMINAL_PATCH_STATE];
}

/**
 * Wraps an editor factory so each created editor receives cursor patches.
 *
 * @param factory - The configured editor factory, when one exists.
 * @param registerTUI - Registers the TUI that owns the created editor.
 * @returns A factory that creates and patches an editor.
 */
function wrapEditorFactory(
  factory: EditorFactory | undefined,
  registerTUI: RegisterCursorTUI,
): EditorFactory {
  const wrappedFactory: EditorFactory = (tui, theme, keybindings) => {
    registerTUI(tui as CursorTUI);
    const editor = factory
      ? factory(tui, theme, keybindings)
      : new CustomEditor(tui, theme, keybindings);
    patchEditorRender(editor as PatchableEditor);
    return editor;
  };

  return wrappedFactory;
}

/**
 * Patches editor installation so current and future editors use the wrapper.
 *
 * @param ui - Pi's editor component API.
 * @param registerTUI - Registers each TUI that creates an editor.
 */
function installEditorComponentPatch(
  ui: PatchableEditorUI,
  registerTUI: RegisterCursorTUI,
): void {
  if (ui[UI_PATCH_STATE]) return;

  const originalSetEditorComponent = ui.setEditorComponent.bind(ui);

  /**
   * Installs an editor factory after adding the cursor wrapper.
   *
   * @param factory - The editor factory to install, when one exists.
   */
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

/**
 * Restores the original editor installation function when this patch owns it.
 *
 * @param ui - Pi's editor component API.
 */
function removeEditorComponentPatch(ui: PatchableEditorUI): void {
  const state = ui[UI_PATCH_STATE];
  if (!state) return;

  if (ui.setEditorComponent === state.patchedSetEditorComponent) {
    ui.setEditorComponent = state.originalSetEditorComponent;
  }
  delete ui[UI_PATCH_STATE];
}

/**
 * Installs hardware cursor rendering and terminal focus handling for Pi.
 *
 * @param pi - Pi's extension API.
 */
export default function blinkingCursor(pi: ExtensionAPI): void {
  let cursorControlsEnabled = false;
  let terminalFocused = true;
  let focusInputRemainder = "";
  let patchedUI: PatchableEditorUI | undefined;
  const cursorTuis = new Set<CursorTUI>();

  /**
   * Reports whether any registered TUI last requested a visible cursor.
   *
   * @returns `true` when a TUI render requested a visible cursor.
   */
  const renderRequestedCursor = (): boolean => {
    for (const tui of cursorTuis) {
      if (tui.terminal[TERMINAL_PATCH_STATE]?.renderRequestedCursor) {
        return true;
      }
    }
    return false;
  };

  /**
   * Updates terminal focus and applies the active component's cursor request.
   *
   * @param focused - Whether the terminal or tmux pane now has focus.
   */
  const setTerminalFocused = (focused: boolean): void => {
    if (terminalFocused === focused) return;
    terminalFocused = focused;

    process.stdout.write(
      focused && renderRequestedCursor() ? SHOW_CURSOR : HIDE_CURSOR,
    );
  };

  /**
   * Reports the current terminal focus state to the terminal write patch.
   *
   * @returns `true` when the terminal or tmux pane has focus.
   */
  const isTerminalFocused = (): boolean => terminalFocused;

  /**
   * Registers a TUI and enables its hardware cursor marker handling.
   *
   * @param tui - The TUI instance to register.
   */
  const registerTUI: RegisterCursorTUI = (tui) => {
    patchTerminalWrite(tui.terminal, isTerminalFocused);
    cursorTuis.add(tui);
    // Keep Pi's cursor-marker behavior active. The terminal patch masks cursor
    // show commands while the pane or terminal window is unfocused.
    tui.showHardwareCursor = true;
  };

  /**
   * Reads terminal input and applies all complete focus events in the data.
   *
   * @param data - Raw terminal input from standard input.
   */
  const handleTerminalInput = (data: Buffer | string): void => {
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

  /**
   * Installs cursor patches and terminal controls for a TUI session.
   *
   * @param _event - Pi's session start event.
   * @param ctx - The session context that provides the TUI API.
   */
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

  /**
   * Removes all patches and restores the terminal's default cursor controls.
   */
  pi.on("session_shutdown", () => {
    if (patchedUI) {
      removeEditorComponentPatch(patchedUI);
      patchedUI = undefined;
    }
    process.stdin.removeListener("data", handleTerminalInput);
    for (const tui of cursorTuis) {
      removeTerminalWritePatch(tui.terminal);
    }
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
