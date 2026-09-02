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
import {
  CURSOR_MARKER,
  getKeybindings,
  isKeyRelease,
  type Keybinding,
  type Terminal,
} from "@earendil-works/pi-tui";

const PATCH_STATE = Symbol.for("blinking-cursor.editor-render.patch");
const UI_PATCH_STATE = Symbol.for("blinking-cursor.editor-component.patch");
const TERMINAL_PATCH_STATE = Symbol.for("blinking-cursor.terminal-write.patch");
const INVERSE_VIDEO = "\x1b[7m";
const STEADY_BLOCK_CURSOR = "\x1b[2 q";
const DEFAULT_CURSOR = "\x1b[0 q";
const BLINK_INTERVAL_MS = 500;
const SHOW_CURSOR = "\x1b[?25h";
const HIDE_CURSOR = "\x1b[?25l";
const ENABLE_FOCUS_REPORTING = "\x1b[?1004h";
const DISABLE_FOCUS_REPORTING = "\x1b[?1004l";
const BEGIN_SYNCHRONIZED_OUTPUT = "\x1b[?2026h";
const END_SYNCHRONIZED_OUTPUT = "\x1b[?2026l";
const FOCUS_EVENT_PATTERN = /\x1b\[([IO])/g;
const MOUSE_WHEEL_EVENT_PATTERN = /\x1b\[<6[45];\d+;\d+[Mm]/;
const TRANSCRIPT_SCROLL_KEYBINDINGS = [
  "tui.altScreen.pageUp",
  "tui.altScreen.pageDown",
  "tui.altScreen.halfPageUp",
  "tui.altScreen.halfPageDown",
  "tui.altScreen.lineUp",
  "tui.altScreen.lineDown",
  "tui.altScreen.previousPrompt",
  "tui.altScreen.nextPrompt",
  "tui.altScreen.top",
  "tui.altScreen.bottom",
] as const satisfies readonly Keybinding[];

type EditorRender = (width: number) => string[];
type EditorFactory = NonNullable<
  ReturnType<ExtensionUIContext["getEditorComponent"]>
>;
type TerminalWrite = Terminal["write"];
type TerminalPatchState = {
  originalWrite: TerminalWrite;
  patchedWrite: TerminalWrite;
  renderRequestedCursor: boolean;
  emittedCursorVisible: boolean;
  synchronizedOutputBuffer?: string;
};
type PatchableTerminal = Pick<Terminal, "write"> & {
  [TERMINAL_PATCH_STATE]?: TerminalPatchState;
};
type CursorTUI = Parameters<EditorFactory>[0] & {
  terminal: PatchableTerminal;
  getShowHardwareCursor(): boolean;
  setShowHardwareCursor(enabled: boolean): void;
  requestRender(force?: boolean): void;
};
type RegisterCursorTUI = (tui: CursorTUI) => void;
type ShouldUseHardwareCursor = () => boolean;

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
 * @param shouldUseHardwareCursor - Reports which cursor mode is active.
 */
function patchEditorRender(
  target: PatchableEditor,
  shouldUseHardwareCursor: ShouldUseHardwareCursor,
): void {
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
    const lines = originalRender.call(this, width);
    return shouldUseHardwareCursor() ? lines.map(removeSoftwareCursor) : lines;
  };

  target[PATCH_STATE] = { originalRender };
  target.render = patchedRender;
}

/**
 * Hides the hardware cursor while a synchronized repaint moves across rows.
 *
 * Pi's cursor requests are removed because the fixed-phase blink clock owns
 * visibility. tmux synchronized-update support keeps these internal cursor
 * transitions out of the displayed frame.
 *
 * @param data - One complete synchronized repaint frame.
 * @param restoreCursor - Whether the cursor must be visible after the frame.
 * @returns A frame that hides before movement and restores after movement.
 */
function protectSynchronizedRepaint(
  data: string,
  restoreCursor: boolean,
): string {
  let output = data.replaceAll(HIDE_CURSOR, "").replaceAll(SHOW_CURSOR, "");
  output = output.replaceAll(
    BEGIN_SYNCHRONIZED_OUTPUT,
    BEGIN_SYNCHRONIZED_OUTPUT + HIDE_CURSOR,
  );
  if (restoreCursor) {
    output = output.replaceAll(
      END_SYNCHRONIZED_OUTPUT,
      SHOW_CURSOR + END_SYNCHRONIZED_OUTPUT,
    );
  }
  return output;
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
  isBlinkVisible: () => boolean,
): void {
  if (terminal[TERMINAL_PATCH_STATE]) return;

  const originalWrite = terminal.write;
  let state: TerminalPatchState;

  /**
   * Writes one complete plain output chunk or synchronized repaint frame.
   *
   * @param target - The terminal that owns the original write function.
   * @param data - Complete output to process.
   * @param synchronized - Whether `data` is one synchronized repaint frame.
   */
  const writeCompleteOutput = (
    target: PatchableTerminal,
    data: string,
    synchronized: boolean,
  ): void => {
    const requestedVisibility = requestedCursorVisibility(data);
    if (requestedVisibility !== undefined) {
      state.renderRequestedCursor = requestedVisibility;
    }

    const shouldShowCursor =
      isTerminalFocused() && isBlinkVisible() && state.renderRequestedCursor;
    if (synchronized) {
      originalWrite.call(
        target,
        protectSynchronizedRepaint(data, shouldShowCursor),
      );
      state.emittedCursorVisible = shouldShowCursor;
      return;
    }

    const output = data.replaceAll(HIDE_CURSOR, "").replaceAll(SHOW_CURSOR, "");
    originalWrite.call(target, output);
    if (shouldShowCursor !== state.emittedCursorVisible) {
      originalWrite.call(target, shouldShowCursor ? SHOW_CURSOR : HIDE_CURSOR);
      state.emittedCursorVisible = shouldShowCursor;
    }
  };

  /**
   * Buffers split synchronized frames and emits each frame as one write.
   *
   * @param target - The terminal that owns the original write function.
   * @param data - The next terminal output chunk from Pi.
   */
  const writeBufferedOutput = (
    target: PatchableTerminal,
    data: string,
  ): void => {
    let remaining = data;
    while (remaining.length > 0) {
      if (state.synchronizedOutputBuffer !== undefined) {
        const endIndex = remaining.indexOf(END_SYNCHRONIZED_OUTPUT);
        if (endIndex < 0) {
          state.synchronizedOutputBuffer += remaining;
          return;
        }

        const afterEnd = endIndex + END_SYNCHRONIZED_OUTPUT.length;
        const frame =
          state.synchronizedOutputBuffer + remaining.slice(0, afterEnd);
        state.synchronizedOutputBuffer = undefined;
        writeCompleteOutput(target, frame, true);
        remaining = remaining.slice(afterEnd);
        continue;
      }

      const beginIndex = remaining.indexOf(BEGIN_SYNCHRONIZED_OUTPUT);
      if (beginIndex < 0) {
        writeCompleteOutput(target, remaining, false);
        return;
      }
      if (beginIndex > 0) {
        writeCompleteOutput(target, remaining.slice(0, beginIndex), false);
        remaining = remaining.slice(beginIndex);
      }

      const endIndex = remaining.indexOf(
        END_SYNCHRONIZED_OUTPUT,
        BEGIN_SYNCHRONIZED_OUTPUT.length,
      );
      if (endIndex < 0) {
        state.synchronizedOutputBuffer = remaining;
        return;
      }

      const afterEnd = endIndex + END_SYNCHRONIZED_OUTPUT.length;
      writeCompleteOutput(target, remaining.slice(0, afterEnd), true);
      remaining = remaining.slice(afterEnd);
    }
  };

  /**
   * Records Pi's cursor request and writes output with focus-safe cursor commands.
   *
   * @param data - The terminal output from Pi.
   */
  const patchedWrite: TerminalWrite = function cursorSafeWrite(
    this: PatchableTerminal,
    data,
  ) {
    writeBufferedOutput(this, data);
  };
  state = {
    originalWrite,
    patchedWrite,
    renderRequestedCursor: true,
    emittedCursorVisible: true,
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
  shouldUseHardwareCursor: ShouldUseHardwareCursor,
): EditorFactory {
  const wrappedFactory: EditorFactory = (tui, theme, keybindings) => {
    registerTUI(tui as CursorTUI);
    const editor = factory
      ? factory(tui, theme, keybindings)
      : new CustomEditor(tui, theme, keybindings);
    patchEditorRender(editor as PatchableEditor, shouldUseHardwareCursor);
    return editor;
  };

  return wrappedFactory;
}

/**
 * Patches editor installation so current and future editors use the wrapper.
 *
 * @param ui - Pi's editor component API.
 * @param registerTUI - Registers each TUI that creates an editor.
 * @param shouldUseHardwareCursor - Reports which cursor mode is active.
 */
function installEditorComponentPatch(
  ui: PatchableEditorUI,
  registerTUI: RegisterCursorTUI,
  shouldUseHardwareCursor: ShouldUseHardwareCursor,
): void {
  if (ui[UI_PATCH_STATE]) return;

  const originalSetEditorComponent = ui.setEditorComponent.bind(ui);

  /**
   * Installs an editor factory after adding the cursor wrapper.
   *
   * @param factory - The editor factory to install, when one exists.
   */
  const patchedSetEditorComponent: SetEditorComponent = (factory) => {
    originalSetEditorComponent(
      wrapEditorFactory(factory, registerTUI, shouldUseHardwareCursor),
    );
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
  let blinkVisible = true;
  let blinkTimer: ReturnType<typeof setTimeout> | undefined;
  let scrollIdleTimer: ReturnType<typeof setTimeout> | undefined;
  let nextBlinkAt = 0;
  let scrolling = false;
  let focusInputRemainder = "";
  let patchedUI: PatchableEditorUI | undefined;
  const cursorTuis = new Set<CursorTUI>();

  /**
   * Reports the current terminal focus state to the terminal write patch.
   *
   * @returns `true` when the terminal or tmux pane has focus.
   */
  const isTerminalFocused = (): boolean => terminalFocused;

  /**
   * Reports the current fixed-clock blink phase.
   *
   * @returns `true` during the visible half of the blink cycle.
   */
  const isBlinkVisible = (): boolean => blinkVisible;

  /**
   * Reports whether editor rendering should use the hardware cursor.
   *
   * The software cursor is visible only while scrolling in a focused terminal.
   */
  const shouldUseHardwareCursor = (): boolean => !scrolling || !terminalFocused;

  /**
   * Applies the current focus, component, and blink state to each terminal.
   *
   * @param force - Whether to emit a command even when visibility is unchanged.
   */
  const refreshCursorVisibility = (force = false): void => {
    let foundTerminal = false;
    for (const tui of cursorTuis) {
      const state = tui.terminal[TERMINAL_PATCH_STATE];
      if (!state) continue;
      foundTerminal = true;
      const shouldShowCursor =
        terminalFocused && blinkVisible && state.renderRequestedCursor;
      if (!force && shouldShowCursor === state.emittedCursorVisible) continue;
      state.originalWrite.call(
        tui.terminal,
        shouldShowCursor ? SHOW_CURSOR : HIDE_CURSOR,
      );
      state.emittedCursorVisible = shouldShowCursor;
    }

    if (force && !foundTerminal) {
      process.stdout.write(
        terminalFocused && blinkVisible ? SHOW_CURSOR : HIDE_CURSOR,
      );
    }
  };

  /**
   * Holds the cursor visible until one full idle interval has elapsed.
   *
   * Keyboard activity and focus-in both restart this delay without requesting
   * a TUI repaint.
   */
  const holdCursorVisible = (): void => {
    blinkVisible = true;
    nextBlinkAt = performance.now() + BLINK_INTERVAL_MS;
    refreshCursorVisibility();
  };

  /**
   * Switches between hardware and software cursor rendering.
   *
   * @param active - Whether scrolling owns a solid software cursor.
   */
  const setScrolling = (active: boolean): void => {
    if (scrolling === active) return;
    scrolling = active;
    for (const tui of cursorTuis) {
      tui.setShowHardwareCursor(!active);
    }
  };

  /**
   * Shows a solid software cursor until scroll input is idle for 500 ms.
   */
  const holdSoftwareCursorDuringScroll = (): void => {
    holdCursorVisible();
    setScrolling(true);
    if (scrollIdleTimer) clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(() => {
      scrollIdleTimer = undefined;
      setScrolling(false);
    }, BLINK_INTERVAL_MS);
    scrollIdleTimer.unref();
  };

  /**
   * Reports whether input matches a configured transcript scroll hotkey.
   *
   * @param input - One complete terminal key event.
   * @returns `true` for a press or repeat of a transcript scroll binding.
   */
  const isTranscriptScrollHotkey = (input: string): boolean => {
    if (input.length === 0 || isKeyRelease(input)) return false;
    const keybindings = getKeybindings();
    return TRANSCRIPT_SCROLL_KEYBINDINGS.some((action) =>
      keybindings.matches(input, action),
    );
  };

  /**
   * Reports whether complete terminal input contains keyboard activity.
   *
   * Focus reports and wheel scrolling must not reset the blink clock.
   *
   * @param input - Complete terminal input without a partial focus sequence.
   * @returns `true` when input should hold the cursor visible.
   */
  const containsKeyboardActivity = (input: string): boolean => {
    return (
      input
        .replace(FOCUS_EVENT_PATTERN, "")
        .replace(MOUSE_WHEEL_EVENT_PATTERN, "").length > 0
    );
  };

  /**
   * Advances the blink phase from an absolute deadline, not from render time.
   */
  const runBlinkClock = (): void => {
    const now = performance.now();
    if (now >= nextBlinkAt) {
      const elapsedIntervals =
        Math.floor((now - nextBlinkAt) / BLINK_INTERVAL_MS) + 1;
      if (elapsedIntervals % 2 === 1) blinkVisible = !blinkVisible;
      nextBlinkAt += elapsedIntervals * BLINK_INTERVAL_MS;
      refreshCursorVisibility();
    }

    blinkTimer = setTimeout(
      runBlinkClock,
      Math.max(1, nextBlinkAt - performance.now()),
    );
    blinkTimer.unref();
  };

  /**
   * Starts the fixed-phase cursor blink clock.
   */
  const startBlinkClock = (): void => {
    if (blinkTimer) clearTimeout(blinkTimer);
    blinkVisible = true;
    nextBlinkAt = performance.now() + BLINK_INTERVAL_MS;
    runBlinkClock();
  };

  /**
   * Stops the fixed-phase cursor blink clock.
   */
  const stopBlinkClock = (): void => {
    if (blinkTimer) clearTimeout(blinkTimer);
    blinkTimer = undefined;
    blinkVisible = true;
  };

  /**
   * Updates terminal focus without requesting an expensive TUI repaint.
   *
   * @param focused - Whether the terminal or tmux pane now has focus.
   */
  const setTerminalFocused = (focused: boolean): void => {
    if (terminalFocused === focused) return;
    terminalFocused = focused;
    if (scrolling) {
      for (const tui of cursorTuis) tui.requestRender();
    }
    if (focused) {
      holdCursorVisible();
      return;
    }
    refreshCursorVisibility(true);
  };

  /**
   * Registers a TUI and enables its hardware cursor marker handling.
   *
   * @param tui - The TUI instance to register.
   */
  const registerTUI: RegisterCursorTUI = (tui) => {
    patchTerminalWrite(tui.terminal, isTerminalFocused, isBlinkVisible);
    cursorTuis.add(tui);
    // Keep Pi's cursor-marker behavior active outside scroll bursts. The
    // terminal patch masks cursor movement and owns hardware visibility.
    tui.setShowHardwareCursor(!scrolling);
    refreshCursorVisibility();
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
    const completeInput = focusInputRemainder
      ? input.slice(0, -focusInputRemainder.length)
      : input;
    if (
      MOUSE_WHEEL_EVENT_PATTERN.test(completeInput) ||
      isTranscriptScrollHotkey(completeInput)
    ) {
      holdSoftwareCursorDuringScroll();
    } else if (containsKeyboardActivity(completeInput)) {
      holdCursorVisible();
    }

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
      installEditorComponentPatch(
        patchedUI,
        registerTUI,
        shouldUseHardwareCursor,
      );

      // Run before Pi's input listener so cursor mode changes before the
      // wheel-triggered repaint. Focus reporting covers panes and windows.
      process.stdin.prependListener("data", handleTerminalInput);
      process.stdout.write(
        ENABLE_FOCUS_REPORTING + STEADY_BLOCK_CURSOR + SHOW_CURSOR,
      );
      startBlinkClock();
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
    stopBlinkClock();
    if (scrollIdleTimer) clearTimeout(scrollIdleTimer);
    scrollIdleTimer = undefined;
    scrolling = false;
    for (const tui of cursorTuis) {
      tui.setShowHardwareCursor(true);
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
