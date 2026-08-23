import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";

import { AgentRenderer } from "../renderer/agent-renderer.ts";
import { ContinuationRenderer } from "../renderer/continuation-renderer.ts";
import { SideQuestResultRenderer } from "../renderer/side-quest-result-renderer.ts";
import {
  CHILD_WIDGET_ID,
  WidgetStackSpacing,
} from "../renderer/widget-spacing.ts";
import type { ChildRuntime } from "./runtime.ts";

const REFRESH_INTERVAL_MS = 1_000;

/**
 * Owns child identity rendering above the child editor.
 */
export class ChildUI {
  /**
   * Registers the child identity widget.
   */
  public static register(pi: ExtensionAPI, runtime: ChildRuntime): ChildUI {
    AgentRenderer.register(pi);
    ContinuationRenderer.register(pi);
    SideQuestResultRenderer.register(pi);
    WidgetStackSpacing.install();

    const ui = new ChildUI(pi, runtime);
    ui.installEventListeners();
    return ui;
  }

  /** Records the timer that refreshes elapsed child runtime. */
  private widgetRefreshTimer: ReturnType<typeof setInterval> | undefined;

  /** Requests a render from the installed child widget. */
  private requestWidgetRender: (() => void) | undefined;

  private constructor(
    private readonly pi: ExtensionAPI,
    private readonly runtime: ChildRuntime,
  ) {}

  /**
   * Renders the responsive child identity widget.
   */
  static renderWidget(runtime: ChildRuntime, width: number): string[] {
    if (width < 4) return [];

    const { manifest, lifecycle, replyPending } = runtime.status();
    const innerWidth = width - 2;
    const sidePadding = Math.min(2, Math.floor(innerWidth / 2));
    const contentWidth = innerWidth - sidePadding * 2;
    const elapsed = ChildUI.elapsed(manifest.createdAt);
    const lifecycleState = `${lifecycle}${replyPending ? " · reply pending" : ""}`;
    const taskWidth =
      contentWidth - visibleWidth(elapsed) - visibleWidth(lifecycleState) - 4;
    const content =
      taskWidth >= 1
        ? [
            elapsed,
            ChildUI.pad(manifest.description, taskWidth, " ", "…"),
            lifecycleState,
          ].join("  ")
        : ChildUI.pad(`${elapsed}  ${lifecycleState}`, contentWidth, " ", "…");
    const title = ChildUI.pad(
      `─ [${manifest.displayName}] `,
      innerWidth,
      "─",
      "…",
    );

    const padding = " ".repeat(sidePadding);

    return [
      `╭${title}╮`,
      `│${padding}${ChildUI.pad(content, contentWidth)}${padding}│`,
      `╰${"─".repeat(innerWidth)}╯`,
    ];
  }

  /**
   * Registers session-scoped child widget handlers.
   */
  private installEventListeners(): void {
    this.pi.on("session_start", (_event, context) => {
      this.startSessionUI(context);
    });
    this.pi.on("session_shutdown", (_event, context) => {
      this.stopSessionUi(context);
    });
  }

  /**
   * Installs the child widget and starts its refresh timer.
   */
  private startSessionUI(context: ExtensionContext): void {
    this.clearWidgetRefreshTimer();

    if (context.mode !== "tui") return;

    context.ui.setWidget(
      CHILD_WIDGET_ID,
      (tui) => {
        this.requestWidgetRender = () => tui.requestRender();

        return {
          render: (width: number) => ChildUI.renderWidget(this.runtime, width),
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
   * Removes child widget state and stops its refresh timer.
   */
  private stopSessionUi(context: ExtensionContext): void {
    this.clearWidgetRefreshTimer();
    this.requestWidgetRender = undefined;

    context.ui.setWidget(CHILD_WIDGET_ID, undefined);
  }

  /**
   * Stops the child-widget refresh timer when it exists.
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
