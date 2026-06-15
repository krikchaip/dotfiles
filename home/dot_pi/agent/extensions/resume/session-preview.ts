/**
 * Adds a Treex-like preview pane below /resume.
 *
 * Renders recent session entries with Pi's native message components, supports
 * collapsed/expanded preview modes, and handles preview scrolling keys.
 */

import { statSync } from "node:fs";
import {
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

// ─── User-configurable constants ────────────────────────────────────────────
// TODO: Make these configurable via a config file.

/** Number of body lines shown in the collapsed preview pane (below metadata). */
const COLLAPSED_PREVIEW_LINES = 3;

/** Max session entries (from tail) rendered in the expanded/collapsed preview.
 *  Higher = more context visible but slower initial render for large sessions. */
const EXPANDED_PREVIEW_ENTRIES = 20;

/** Key binding to toggle expanded preview. */
const EXPAND_KEY = "ctrl+shift+r";

/** Display label for the expand key hint shown in collapsed preview. */
const EXPAND_KEY_HINT = "Ctrl+Shift+R";

export interface SessionPreviewDeps {
  loadEntriesFromFile(path: string): any[];
  getMarkdownTheme(): any;
  theme: any;
  components: any;
}

function formatDate(date: Date | undefined) {
  if (!date) return "unknown";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fitLine(line: string, width: number) {
  return truncateToWidth(line, Math.max(0, width), "…");
}

function borderLine(theme: any, width: number) {
  return theme.fg("accent", "─".repeat(Math.max(0, width)));
}

function appendRightHint(
  line: string,
  width: number,
  theme: any,
  hintText: string,
) {
  const hint = theme.fg("dim", hintText);
  const hintWidth = visibleWidth(hint);
  if (width <= hintWidth) return fitLine(hint, width);

  const left = truncateToWidth(line, Math.max(1, width - hintWidth), "");
  const pad = Math.max(0, width - visibleWidth(left) - hintWidth);
  return `${left}${" ".repeat(pad)}${hint}`;
}

function compactSelectorLines(lines: string[]) {
  const result = [...lines];

  if (result[2] === "") result.splice(2, 1);
  if (result.length >= 2 && result[result.length - 2] === "") {
    result.splice(result.length - 2, 1);
  }

  return result;
}

function selectedSession(selector: any) {
  const list =
    typeof selector.getSessionList === "function"
      ? selector.getSessionList()
      : selector.sessionList;
  return list?.filteredSessions?.[list.selectedIndex]?.session;
}

function normalizedText(value: unknown) {
  return String(value ?? "")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\t/g, "    ")
    .trim();
}

function sessionTitle(session: any) {
  return normalizedText(session?.name) || "Untitled";
}

function textContent(content: any) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

function normalizeAssistantMessage(message: any) {
  if (typeof message?.content !== "string") return message;
  return { ...message, content: [{ type: "text", text: message.content }] };
}

function isBlankLine(line: string) {
  return visibleWidth(line) === 0;
}

function separateBlocks(blocks: string[][]) {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.length === 0) continue;

    let start = 0;
    while (start < block.length && isBlankLine(block[start])) start++;
    let end = block.length;
    while (end > start && isBlankLine(block[end - 1])) end--;
    const trimmed = block.slice(start, end);
    if (trimmed.length === 0) continue;

    if (lines.length > 0) lines.push("");
    lines.push(...trimmed);
  }
  return lines;
}

class SessionEntryRenderer {
  private entryCache = new Map<string, { mtimeMs: number; entries: any[] }>();
  private lineCache = new Map<string, { width: number; lines: string[] }>();

  constructor(
    private readonly interactiveMode: any,
    private readonly deps: SessionPreviewDeps,
  ) {}

  private markdownTheme() {
    return (
      this.interactiveMode.getMarkdownThemeWithSettings?.() ??
      this.deps.getMarkdownTheme()
    );
  }

  private entries(session: any) {
    const path = session?.path;
    if (!path) return [];

    try {
      const mtimeMs = statSync(path).mtimeMs;
      const cached = this.entryCache.get(path);
      if (cached && cached.mtimeMs === mtimeMs) return cached.entries;

      const entries = this.deps.loadEntriesFromFile(path);
      this.entryCache.set(path, { mtimeMs, entries });
      return entries;
    } catch {
      return [];
    }
  }

  private renderEntry(entry: any, width: number) {
    const markdownTheme = this.markdownTheme();
    const components = this.deps.components;

    if (entry.type === "message") {
      const message = entry.message;
      if (message?.role === "user") {
        return new components.UserMessageComponent(
          textContent(message.content),
          markdownTheme,
        ).render(width);
      }
      if (message?.role === "assistant") {
        return new components.AssistantMessageComponent(
          normalizeAssistantMessage(message),
          this.interactiveMode.hideThinkingBlock,
          markdownTheme,
          this.interactiveMode.hiddenThinkingLabel,
        ).render(width);
      }
      if (message?.role === "bashExecution") {
        const component = new components.BashExecutionComponent(
          message.command ?? "",
          this.interactiveMode.ui,
          message.excludeFromContext,
        );
        if (message.output) component.appendOutput(message.output);
        component.setExpanded(true);
        component.setComplete(
          message.exitCode,
          message.cancelled,
          message.truncated ? { truncated: true } : undefined,
          message.fullOutputPath,
        );
        return component.render(width);
      }
    }

    if (entry.type === "compaction") {
      const component = new components.CompactionSummaryMessageComponent(
        entry,
        markdownTheme,
      );
      component.setExpanded(true);
      return component.render(width);
    }

    if (entry.type === "branch_summary") {
      const component = new components.BranchSummaryMessageComponent(
        entry,
        markdownTheme,
      );
      component.setExpanded(true);
      return component.render(width);
    }

    if (entry.type === "custom_message" && entry.display) {
      const renderer =
        this.interactiveMode.session?.extensionRunner?.getMessageRenderer?.(
          entry.customType,
        );
      const component = new components.CustomMessageComponent(
        entry,
        renderer,
        markdownTheme,
      );
      component.setExpanded(true);
      return component.render(width);
    }

    return [];
  }

  render(session: any, width: number) {
    const key = [
      session?.path ?? "",
      session?.modified?.getTime?.() ?? "",
      session?.messageCount ?? "",
      session?.name ?? "",
    ].join("\0");
    const cached = this.lineCache.get(key);
    if (cached?.width === width) return cached.lines;

    const entries = this.entries(session)
      .filter(
        (entry) =>
          entry?.type === "message" ||
          entry?.type === "compaction" ||
          entry?.type === "branch_summary" ||
          entry?.type === "custom_message",
      )
      .slice(-EXPANDED_PREVIEW_ENTRIES);

    const result = separateBlocks(
      entries.map((entry) => this.renderEntry(entry, width)),
    );
    const finalLines = result.length > 0 ? result : ["(no preview)"];
    this.lineCache.set(key, { width, lines: finalLines });
    return finalLines;
  }
}

class ResumePreviewPane {
  private expanded = false;
  private scrollFromBottom = 0;
  private lastPath: string | undefined;
  private lineCache = new Map<
    string,
    {
      width?: number;
      lines?: string[];
    }
  >();

  constructor(
    private readonly getTerminalRows: () => number,
    private readonly theme: any,
    private readonly renderExpandedLines: (
      session: any,
      width: number,
    ) => string[],
  ) {}

  handleInput(data: string) {
    if (matchesKey(data, EXPAND_KEY)) {
      this.expanded = !this.expanded;
      this.scrollFromBottom = 0;
      return true;
    }

    if (!this.expanded) return false;

    if (matchesKey(data, "escape")) {
      this.expanded = false;
      this.scrollFromBottom = 0;
      return true;
    }
    if (matchesKey(data, "shift+up")) {
      this.scrollFromBottom += 1;
      return true;
    }
    if (matchesKey(data, "shift+down")) {
      this.scrollFromBottom = Math.max(0, this.scrollFromBottom - 1);
      return true;
    }
    if (matchesKey(data, "shift+pageUp")) {
      this.scrollFromBottom += 10;
      return true;
    }
    if (matchesKey(data, "shift+pageDown")) {
      this.scrollFromBottom = Math.max(0, this.scrollFromBottom - 10);
      return true;
    }
    if (matchesKey(data, "home")) {
      this.scrollFromBottom = Number.POSITIVE_INFINITY;
      return true;
    }
    if (matchesKey(data, "end")) {
      this.scrollFromBottom = 0;
      return true;
    }

    return false;
  }

  private cacheKey(session: any) {
    return [
      session?.path ?? "",
      session?.modified?.getTime?.() ?? "",
      session?.messageCount ?? "",
      session?.name ?? "",
    ].join("\0");
  }

  private bodyLines(session: any, width: number) {
    const key = this.cacheKey(session);
    const cached = this.lineCache.get(key) ?? {};

    if (cached.width === width && cached.lines) {
      return cached.lines;
    }

    const result = this.renderExpandedLines(session, Math.max(1, width));
    this.lineCache.set(key, { width, lines: result });
    return result;
  }

  private metadata(session: any, width: number) {
    const parts = [
      this.theme.bold(this.theme.fg("accent", sessionTitle(session))),
      this.theme.fg("muted", normalizedText(session?.id)),
      this.theme.fg("muted", `${session?.messageCount ?? 0} msgs`),
      this.theme.fg("muted", formatDate(session?.modified) + " (M)"),
    ];

    return fitLine(parts.join(this.theme.fg("muted", " · ")), width);
  }

  render(session: any, width: number, selectorHeight: number) {
    if (!session) return [];

    if (session.path !== this.lastPath) {
      this.lastPath = session.path;
      this.scrollFromBottom = 0;
    }

    const contentWidth = Math.max(1, width);
    const allBodyLines = this.bodyLines(session, contentWidth);
    const bodyHeight = this.expanded
      ? Math.max(1, this.getTerminalRows() - selectorHeight - 4)
      : COLLAPSED_PREVIEW_LINES;

    const maxOffset = Math.max(0, allBodyLines.length - bodyHeight);
    this.scrollFromBottom = Math.max(
      0,
      Math.min(this.scrollFromBottom, maxOffset),
    );
    const start = Math.max(0, maxOffset - this.scrollFromBottom);
    const end = Math.min(allBodyLines.length, start + bodyHeight);
    const visible = allBodyLines.slice(start, end);
    while (visible.length < bodyHeight) visible.push("");

    if (!this.expanded) {
      if (allBodyLines.length > bodyHeight) {
        visible[visible.length - 1] = appendRightHint(
          visible[visible.length - 1] ?? "",
          width,
          this.theme,
          `… ${EXPAND_KEY_HINT} full`,
        );
      }

      return [
        this.metadata(session, width),
        ...visible.map((line) => fitLine(line, width)),
        fitLine(borderLine(this.theme, width), width),
      ];
    }

    const help = [
      `${start + 1}-${end}/${allBodyLines.length}`,
      "Shift+↑/↓ scroll",
      "Shift+PgUp/PgDn page",
      "Home/End",
      "Esc/Ctrl+Shift+R collapse",
    ].join(" · ");

    return [
      this.metadata(session, width),
      fitLine(borderLine(this.theme, width), width),
      ...visible.map((line) => fitLine(line, width)),
      fitLine(this.theme.fg("dim", help), width),
      fitLine(borderLine(this.theme, width), width),
    ];
  }
}

class ResumeSelectorWithPreview {
  private readonly preview: ResumePreviewPane;

  constructor(
    private readonly selector: any,
    private readonly interactiveMode: any,
    deps: SessionPreviewDeps,
  ) {
    const renderer = new SessionEntryRenderer(this.interactiveMode, deps);

    this.preview = new ResumePreviewPane(
      () => this.interactiveMode.ui?.terminal?.rows ?? 40,
      deps.theme,
      (session, width) => renderer.render(session, width),
    );
  }

  get focused() {
    return this.selector.focused;
  }

  set focused(value: boolean) {
    this.selector.focused = value;
  }

  handleInput(data: string) {
    if (this.preview.handleInput(data)) {
      this.interactiveMode.ui?.requestRender?.();
      return;
    }
    this.selector.handleInput(data);
    this.interactiveMode.ui?.requestRender?.();
  }

  render(width: number) {
    const selectorLines = compactSelectorLines(this.selector.render(width));
    const session = selectedSession(this.selector);
    return [
      ...selectorLines,
      ...this.preview.render(session, width, selectorLines.length),
    ];
  }

  invalidate() {
    this.selector.invalidate?.();
  }

  dispose() {
    this.selector.dispose?.();
  }
}

export function wrapWithSessionPreview(
  selector: any,
  interactiveMode: any,
  deps: SessionPreviewDeps,
) {
  return new ResumeSelectorWithPreview(selector, interactiveMode, deps);
}
