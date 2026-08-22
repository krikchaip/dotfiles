import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type Theme,
  keyHint,
  keyText,
  rawKeyHint,
} from "@earendil-works/pi-coding-agent";
import {
  Box,
  Text,
  sliceByColumn,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

import { AgentRenderer } from "../agent-renderer.ts";
import { PARENT_WIDGET_ID, WidgetStackSpacing } from "../widget-spacing.ts";
import type { ParentRuntime } from "./runtime.ts";

/** Identifies parent messages that report sub-agent events. */
export const RESULT_MESSAGE_TYPE = "side-quest-result";

const REFRESH_INTERVAL_MS = 1_000;
const COLLAPSED_QUESTION_CHAR_LIMIT = 240;

/**
 * Describes optional details shown in an expanded sub-agent event.
 */
export type ResultDetails = Readonly<{
  /** Identifies the sub-agent event. */
  kind?: "parent-request" | "completed" | "failed" | "cancelled" | "closed";

  /** Identifies the sub-agent role that produced the event. */
  subagentType?: string;

  /** Records the sub-agent's current task description. */
  description?: string;

  /** Records a question that the sub-agent sent to its parent. */
  question?: string;

  /** Records the canonical session path for resuming the sub-agent. */
  sessionPath?: string;

  /** Records the final sub-agent response when one exists. */
  response?: string;

  /** Records the terminal failure detail when one exists. */
  error?: string;

  /** Reports whether the sub-agent still has an unanswered parent request. */
  pendingRequest?: boolean;
}>;

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
    WidgetStackSpacing.install();

    const ui = new ParentUI(pi, runtime);

    ui.installEventListeners();
    ui.registerResultRenderer();

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
    context: ExtensionCommandContext,
  ): Promise<NavigationIntent> {
    const initial = this.runtime.children();
    let selectedIndex = 0;
    let refreshTimer: ReturnType<typeof setInterval> | undefined;

    this.selectedChildId = initial[0]?.manifest.childId;
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
   * Registers collapsed and expanded presentation for sub-agent events.
   */
  private registerResultRenderer(): void {
    this.pi.registerMessageRenderer(
      RESULT_MESSAGE_TYPE,
      (message, options, theme) => {
        const details = message.details as ResultDetails | undefined;
        const content = ParentUI.messageText(message.content);
        const title = content.split("\n", 1)[0];
        const heading = title || "Subagent event";

        if (details?.kind === "parent-request") {
          return ParentUI.renderParentRequest(
            details,
            content,
            options.expanded,
            options.outputPad,
            theme,
          );
        }

        if (!options.expanded) {
          const hint = keyHint("app.tools.expand", "to expand");
          return new Text(
            `${theme.fg("accent", heading)} ${theme.fg("dim", `(${hint})`)}`,
            options.outputPad,
            0,
          );
        }

        const text = [
          theme.fg("accent", heading),
          details?.response ? `Result: ${details.response}` : undefined,
          details?.error ? `Error: ${details.error}` : undefined,
          details?.pendingRequest
            ? "A parent question remains unanswered and saved."
            : undefined,
          details?.sessionPath ? `Resume: ${details.sessionPath}` : undefined,
        ]
          .filter((line): line is string => line !== undefined)
          .join("\n");

        return new Text(text, options.outputPad, 0);
      },
    );
  }

  /**
   * Renders one identity-first sub-agent question banner.
   */
  private static renderParentRequest(
    details: ResultDetails,
    content: string,
    expanded: boolean,
    outputPad: number,
    theme: Theme,
  ): Box {
    const type = details.subagentType ?? "general-purpose";
    const description = details.description ?? "Side quest";
    const question =
      details.question ??
      details.response ??
      content.match(/^Subagent asks:\s*([^\n]*)/)?.[1] ??
      "Subagent has a question.";
    const collapsedQuestion = ParentUI.truncateQuestion(question);
    const truncated = !expanded && collapsedQuestion !== question;
    const displayedQuestion = expanded ? question : collapsedQuestion;
    const truncationSuffix = truncated
      ? `${theme.fg("muted", "… ")}${theme.fg("dim", keyText("app.tools.expand"))}${theme.fg("muted", " to expand")}`
      : "";
    const lines = [
      `${theme.fg("customMessageLabel", theme.bold("SUBAGENT ASKS"))}  ${theme.fg("accent", type)}`,
      theme.fg("muted", description),
      "",
      `${theme.fg("customMessageText", displayedQuestion)}${truncationSuffix}`,
      ...(expanded && details.sessionPath
        ? ["", theme.fg("muted", `session path: ${details.sessionPath}`)]
        : []),
    ];
    const box = new Box(Math.max(1, outputPad + 1), 1, (text) =>
      theme.bg("customMessageBg", text),
    );

    box.addChild(new Text(lines.join("\n"), 0, 0));

    return box;
  }

  /**
   * Truncates a collapsed question before its separately styled ellipsis.
   */
  private static truncateQuestion(question: string): string {
    const characters = Array.from(question);
    if (characters.length <= COLLAPSED_QUESTION_CHAR_LIMIT) return question;

    return characters
      .slice(0, COLLAPSED_QUESTION_CHAR_LIMIT)
      .join("")
      .trimEnd();
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
              (text) => theme.fg("accent", text),
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
    accent: (text: string) => string = (text) => text,
  ): string[] {
    const children = runtime.children();
    if (!children.length || width < 4) return [];

    const rows = children.map(
      (child): WidgetRow => ({
        childId: child.manifest.childId,
        elapsed: ParentUI.elapsed(child.manifest.createdAt),
        agent: child.manifest.displayName,
        task: child.manifest.description,
        state: `${runtime.status(child)}${runtime.replyPending(child) ? " · reply needed" : ""}`,
      }),
    );

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
    const title = ParentUI.pad(
      `─ Side Quests · ${children.length} live `,
      innerWidth,
      "─",
      "…",
    );

    return [
      `╭${title}╮`,
      ...rows.map((row) => {
        const text =
          taskWidth >= 1
            ? [
                ParentUI.pad(row.elapsed, elapsedWidth),
                ParentUI.pad(row.agent, agentWidth),
                ParentUI.pad(row.task, taskWidth, " ", "…"),
                ParentUI.pad(row.state, stateWidth),
              ].join("  ")
            : [
                ParentUI.pad(row.elapsed, elapsedWidth),
                ParentUI.pad(
                  row.agent,
                  Math.max(1, contentWidth - elapsedWidth - stateWidth - 4),
                  " ",
                  "…",
                ),
                ParentUI.pad(row.state, stateWidth),
              ].join("  ");
        const marker = row.childId === selectedChildId ? accent("›") : " ";

        return `│${ParentUI.pad(marker, markerWidth)}${" ".repeat(markerGapWidth)}${ParentUI.pad(text, contentWidth)}${" ".repeat(trailingWidth)}│`;
      }),
      `╰${"─".repeat(innerWidth)}╯`,
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
   * Converts a message content value to plain text.
   */
  private static messageText(
    content: string | Array<{ type: string; text?: string }>,
  ): string {
    if (typeof content === "string") return content;

    return content
      .filter(
        (part): part is { type: string; text: string } =>
          part.type === "text" && typeof part.text === "string",
      )
      .map((part) => part.text)
      .join("\n");
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
