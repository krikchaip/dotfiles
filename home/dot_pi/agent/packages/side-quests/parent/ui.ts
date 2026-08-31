import {
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
  keyHint,
  rawKeyHint,
} from "@earendil-works/pi-coding-agent";
import {
  sliceByColumn,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

import { AgentRenderer } from "../renderer/agent-renderer.ts";
import { ContinuationRenderer } from "../renderer/continuation-renderer.ts";
import { SideQuestResultRenderer } from "../renderer/side-quest-result-renderer.ts";
import {
  PARENT_WIDGET_ID,
  WidgetStackSpacing,
} from "../renderer/widget-spacing.ts";
import {
  type WidgetState,
  widgetBottom,
  widgetPalette,
  widgetRow,
  widgetTitle,
} from "../renderer/widget-theme.ts";
import type { ParentRuntime } from "./runtime.ts";

const REFRESH_INTERVAL_MS = 1_000;

/**
 * Describes the pane action selected from live-child navigation.
 */
export type NavigationIntent =
  | Readonly<{
      /** Identifies whether to focus or close the selected pane. */
      action: "focus" | "close";

      /** Identifies the selected managed child. */
      childId: string;
    }>
  | undefined;

/**
 * Describes one rendered row in the live-child widget.
 */
export type WidgetRow = Readonly<{
  /** Identifies the managed child represented by this row. */
  childId: string;

  /** Shows elapsed child runtime as `HH:MM:SS`. */
  elapsed: string;

  /** Shows the configured sub-agent display name. */
  agent: string;

  /** Shows the current side-quest task label. */
  task: string;

  /** Shows activity and pending-reply state. */
  state: string;

  /** Records the child's activity state for semantic coloring. */
  status: WidgetState;

  /** Reports whether the child has an unanswered request. */
  replyPending: boolean;
}>;

/**
 * Owns parent message rendering, the live widget, and row navigation.
 */
export class ParentUI {
  /**
   * Registers the complete parent UI surface.
   */
  public static register(pi: ExtensionAPI, runtime: ParentRuntime): ParentUI {
    AgentRenderer.register(pi);
    ContinuationRenderer.register(pi);
    SideQuestResultRenderer.register(pi);
    WidgetStackSpacing.install();

    const ui = new ParentUI(pi, runtime);

    ui.installEventListeners();

    return ui;
  }

  /** Records the timer that refreshes elapsed time and runtime state. */
  private widgetRefreshTimer: ReturnType<typeof setInterval> | undefined;

  /** Requests a render from the installed widget component. */
  private requestWidgetRender: (() => void) | undefined;

  /** Identifies the selected child while row navigation is active. */
  private selectedChildId: string | undefined;

  private constructor(
    private readonly pi: ExtensionAPI,
    private readonly runtime: ParentRuntime,
  ) {}

  /**
   * Runs scoped row navigation and returns one selected child intent.
   */
  async selectLiveChild(
    context: ExtensionContext,
    initialChildId?: string,
  ): Promise<NavigationIntent> {
    const initial = this.runtime.children();
    const initialIndex = initial.findIndex(
      (child) => child.manifest.childId === initialChildId,
    );
    let selectedIndex = Math.max(0, initialIndex);
    let refreshTimer: ReturnType<typeof setInterval> | undefined;

    this.selectedChildId = initial[selectedIndex]?.manifest.childId;
    this.requestWidgetRender?.();

    const syncSelection = () => {
      const live = this.runtime.children();
      const currentIndex = live.findIndex(
        (child) => child.manifest.childId === this.selectedChildId,
      );

      if (currentIndex >= 0) {
        selectedIndex = currentIndex;
        return live;
      }

      selectedIndex = Math.min(selectedIndex, live.length - 1);
      this.selectedChildId = live[selectedIndex]?.manifest.childId;

      return live;
    };

    try {
      return await context.ui.custom<NavigationIntent>(
        (tui, theme, keybindings, done) => {
          let finished = false;

          const finish = (intent: NavigationIntent) => {
            if (finished) return;
            finished = true;
            done(intent);
          };

          const selectedIntent = (
            action: "focus" | "close",
          ): NavigationIntent => {
            if (!this.selectedChildId) return undefined;
            return { action, childId: this.selectedChildId };
          };

          refreshTimer = setInterval(() => {
            if (!syncSelection().length) {
              return finish(undefined);
            }

            tui.requestRender();
          }, REFRESH_INTERVAL_MS);

          const separator = theme.fg("muted", " · ");
          const hints = [
            keyHint("tui.select.up", "up"),
            keyHint("tui.select.down", "down"),
            keyHint("tui.select.confirm", "open"),
            rawKeyHint("d", "close"),
            keyHint("tui.select.cancel", "cancel"),
          ].join(separator);

          return {
            render: (width: number) => [truncateToWidth(hints, width, "")],
            invalidate() {},
            handleInput: (data: string) => {
              const live = syncSelection();
              if (!live.length) {
                return finish(undefined);
              }

              if (keybindings.matches(data, "tui.select.up")) {
                selectedIndex =
                  selectedIndex === 0 ? live.length - 1 : selectedIndex - 1;

                this.selectedChildId = live[selectedIndex]?.manifest.childId;
                this.requestWidgetRender?.();

                tui.requestRender();

                return;
              }

              if (keybindings.matches(data, "tui.select.down")) {
                selectedIndex = (selectedIndex + 1) % live.length;

                this.selectedChildId = live[selectedIndex]?.manifest.childId;
                this.requestWidgetRender?.();

                tui.requestRender();

                return;
              }

              if (keybindings.matches(data, "tui.select.confirm")) {
                return finish(selectedIntent("focus"));
              }

              if (data === "d") {
                return finish(selectedIntent("close"));
              }

              if (keybindings.matches(data, "tui.select.cancel")) {
                return finish(undefined);
              }
            },
          };
        },
      );
    } finally {
      if (refreshTimer) clearInterval(refreshTimer);
      this.selectedChildId = undefined;
      this.requestWidgetRender?.();
    }
  }

  /**
   * Registers session-scoped widget event handlers.
   */
  private installEventListeners(): void {
    this.pi.on("session_start", (_event, context) => {
      this.startSessionUi(context);
    });

    this.pi.on("session_shutdown", (_event, context) => {
      this.stopSessionUi(context);
    });
  }

  /**
   * Installs the session widget and starts its refresh timer.
   */
  private startSessionUi(context: ExtensionContext): void {
    this.clearWidgetRefreshTimer();

    if (context.mode !== "tui") return;

    context.ui.setWidget(
      PARENT_WIDGET_ID,
      (tui, theme) => {
        this.requestWidgetRender = () => tui.requestRender();

        return {
          render: (width: number) =>
            ParentUI.renderWidget(
              this.runtime,
              width,
              this.selectedChildId,
              theme,
            ),
          invalidate() {},
        };
      },
      { placement: "aboveEditor" },
    );

    this.widgetRefreshTimer = setInterval(() => {
      this.requestWidgetRender?.();
    }, REFRESH_INTERVAL_MS);
  }

  /**
   * Removes all session-scoped UI state and timers.
   */
  private stopSessionUi(context: ExtensionContext): void {
    this.clearWidgetRefreshTimer();

    this.requestWidgetRender = undefined;
    this.selectedChildId = undefined;

    context.ui.setWidget(PARENT_WIDGET_ID, undefined);
  }

  /**
   * Renders the responsive live-child widget.
   */
  public static renderWidget(
    runtime: ParentRuntime,
    width: number,
    selectedChildId?: string,
    theme?: Theme,
  ): string[] {
    const children = runtime.children();
    if (!children.length || width < 4) return [];

    const palette = widgetPalette(theme);
    const rows = children.map((child): WidgetRow => {
      const status = runtime.status(child);
      const replyPending = runtime.replyPending(child);

      return {
        childId: child.manifest.childId,
        elapsed: ParentUI.elapsed(child.manifest.createdAt),
        agent: child.manifest.displayName,
        task: child.manifest.description,
        state: `${status}${replyPending ? " · reply needed" : ""}`,
        status,
        replyPending,
      };
    });

    const innerWidth = width - 2;
    const markerWidth = Math.min(1, innerWidth);
    const markerGapWidth = Math.min(1, innerWidth - markerWidth);
    const trailingWidth = Math.min(
      2,
      innerWidth - markerWidth - markerGapWidth,
    );
    const contentWidth =
      innerWidth - markerWidth - markerGapWidth - trailingWidth;
    const elapsedWidth = Math.max(
      ...rows.map((row) => visibleWidth(row.elapsed)),
    );
    const agentWidth = Math.max(...rows.map((row) => visibleWidth(row.agent)));
    const stateWidth = Math.max(...rows.map((row) => visibleWidth(row.state)));
    const taskWidth = contentWidth - elapsedWidth - agentWidth - stateWidth - 6;

    return [
      widgetTitle(`Side Quests · ${children.length} live`, innerWidth, palette),
      ...rows.map((row) => {
        const elapsed = palette.elapsed(
          ParentUI.pad(row.elapsed, elapsedWidth),
        );
        const state = palette.state(
          row.status,
          row.replyPending,
          ParentUI.pad(row.state, stateWidth),
        );
        const text =
          taskWidth >= 1
            ? [
                elapsed,
                palette.identity(ParentUI.pad(row.agent, agentWidth)),
                ParentUI.pad(row.task, taskWidth, " ", "…"),
                state,
              ].join("  ")
            : [
                elapsed,
                palette.identity(
                  ParentUI.pad(
                    row.agent,
                    Math.max(1, contentWidth - elapsedWidth - stateWidth - 4),
                    " ",
                    "…",
                  ),
                ),
                state,
              ].join("  ");
        const marker =
          row.childId === selectedChildId ? palette.marker("›") : " ";
        const content = `${ParentUI.pad(marker, markerWidth)}${" ".repeat(markerGapWidth)}${ParentUI.pad(text, contentWidth)}${" ".repeat(trailingWidth)}`;

        return widgetRow(content, palette);
      }),
      widgetBottom(innerWidth, palette),
    ];
  }

  /**
   * Stops the live-widget refresh timer when it exists.
   */
  private clearWidgetRefreshTimer(): void {
    if (this.widgetRefreshTimer) clearInterval(this.widgetRefreshTimer);
    this.widgetRefreshTimer = undefined;
  }

  /**
   * Formats elapsed wall time as hours, minutes, and seconds.
   */
  private static elapsed(from: number): string {
    const seconds = Math.max(0, Math.floor((Date.now() - from) / 1_000));

    return [
      Math.floor(seconds / 3_600),
      Math.floor(seconds / 60) % 60,
      seconds % 60,
    ]
      .map((value) => String(value).padStart(2, "0"))
      .join(":");
  }

  /**
   * Truncates and pads text to one exact terminal-cell width.
   */
  private static pad(
    text: string,
    width: number,
    fill = " ",
    ellipsis = "",
  ): string {
    const availableWidth = Math.max(0, width);
    const ellipsisWidth = visibleWidth(ellipsis);
    const truncated =
      visibleWidth(text) <= availableWidth
        ? text
        : `${sliceByColumn(
            text,
            0,
            Math.max(0, availableWidth - ellipsisWidth),
            true,
          )}${ellipsis}`;

    return `${truncated}${fill.repeat(Math.max(0, availableWidth - visibleWidth(truncated)))}`;
  }
}
