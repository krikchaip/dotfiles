/**
 * resumex picker — enhanced session picker with live preview
 *
 * Layout:
 *   - Session selector replaces editor (same as built-in /resume)
 *   - Session previewer renders as overlay above selector
 *   - Previewer is fluid (content height, max = viewport)
 *   - 4-sided border with "Session Preview" title
 *   - Scroll indicators when content exceeds viewport
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  SessionInfo,
} from "@earendil-works/pi-coding-agent";
import {
  getMarkdownTheme,
  SessionManager,
  SessionSelectorComponent,
} from "@earendil-works/pi-coding-agent";
import type { Focusable } from "@earendil-works/pi-tui";
import {
  Markdown,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

import { bumpModifiedByRenames, trackRename } from "./rename-bump.ts";

export type ResumexPickerDismissReason = "cancel" | "exit";
export type ResumexPickerResult =
  | { kind: "selected"; sessionPath: string }
  | { kind: "dismissed"; reason: ResumexPickerDismissReason };

type ResumexPickerContext = Pick<
  ExtensionContext,
  "hasUI" | "cwd" | "sessionManager" | "ui"
>;

// ── Helpers ──

const pad2 = (n: number): string => String(n).padStart(2, "0");

const formatTimestamp = (d: Date): string =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

const buildPreviewLines = (session: SessionInfo): string[] => {
  const text = session.allMessagesText || session.firstMessage || "";
  if (!text.trim()) return [];
  const rawLines = text.split("\n");
  const maxLines = 1200;
  const slice =
    rawLines.length > maxLines
      ? rawLines.slice(rawLines.length - maxLines)
      : rawLines;
  return slice.map((line) => line.replace(/\s+$/g, ""));
};

const clampScroll = (scroll: number, total: number, height: number): number => {
  const max = Math.max(0, total - height);
  return Math.max(0, Math.min(scroll, max));
};

// ── Preview Component (rendered as overlay) ──

const SCROLL_UP = "shift+up";
const SCROLL_DOWN = "shift+down";
const PAGE_UP = "shift+pageup";
const PAGE_DOWN = "shift+pagedown";
const HELP_TEXT = "Shift+Up/Down: scroll • Shift+PageUp/PageDown: page";

class PreviewPane {
  private sessionByPath: Map<string, SessionInfo>;
  private getTermHeight: () => number;
  private getSelectorHeight: () => number;
  private requestRender: () => void;
  private theme: any;

  private previewCache = new Map<string, string[]>();
  private renderCache: { path: string; width: number; lines: string[] } | null =
    null;
  private scrollFromBottom = 0;
  private lastPath: string | undefined;

  constructor(opts: {
    sessionByPath: Map<string, SessionInfo>;
    getTermHeight: () => number;
    getSelectorHeight: () => number;
    requestRender: () => void;
    theme: any;
  }) {
    this.sessionByPath = opts.sessionByPath;
    this.getTermHeight = opts.getTermHeight;
    this.getSelectorHeight = opts.getSelectorHeight;
    this.requestRender = opts.requestRender;
    this.theme = opts.theme;
  }

  private getRawLines(path: string): string[] {
    const cached = this.previewCache.get(path);
    if (cached) return cached;
    const session = this.sessionByPath.get(path);
    const lines = session ? buildPreviewLines(session) : [];
    this.previewCache.set(path, lines);
    return lines;
  }

  private getRendered(path: string, width: number): string[] {
    if (this.renderCache?.path === path && this.renderCache.width === width) {
      return this.renderCache.lines;
    }
    const raw = this.getRawLines(path);
    if (raw.length === 0) {
      const lines = [this.theme.fg("dim", "(no preview)")];
      this.renderCache = { path, width, lines };
      return lines;
    }
    const md = new Markdown(raw.join("\n"), 0, 0, getMarkdownTheme());
    const lines = md.render(width);
    this.renderCache = { path, width, lines };
    return lines;
  }

  handleScrollInput(data: string): boolean {
    if (matchesKey(data, SCROLL_UP)) {
      this.scrollFromBottom += 1;
      this.requestRender();
      return true;
    }
    if (matchesKey(data, SCROLL_DOWN)) {
      this.scrollFromBottom = Math.max(0, this.scrollFromBottom - 1);
      this.requestRender();
      return true;
    }
    if (matchesKey(data, PAGE_UP as any)) {
      this.scrollFromBottom += 10;
      this.requestRender();
      return true;
    }
    if (matchesKey(data, PAGE_DOWN as any)) {
      this.scrollFromBottom = Math.max(0, this.scrollFromBottom - 10);
      this.requestRender();
      return true;
    }
    return false;
  }

  resetScroll(): void {
    this.scrollFromBottom = 0;
    this.renderCache = null;
  }

  setSelectedPath(path: string | undefined): void {
    if (path !== this.lastPath) {
      this.lastPath = path;
      this.scrollFromBottom = 0;
      this.renderCache = null;
    }
  }

  render(selectedPath: string | undefined, width: number): string[] {
    if (!selectedPath) return [];

    const termH = this.getTermHeight();
    const selectorH = this.getSelectorHeight();
    // Available space: viewport minus selector, minus footer(1), minus widget spacer(1)
    const maxHeight = termH - selectorH - 2;
    if (maxHeight < 6) return []; // can't fit min structure, let pi handle it

    // Content width = total width - 2 (borders) - 2 (padding)
    const contentWidth = Math.max(1, width - 4);
    const allLines = this.getRendered(selectedPath, contentWidth);

    const innerW = width - 2; // border left + right
    const needsScroll = allLines.length > maxHeight - 4; // 4 = borders(2) + pad(1) + info(1)

    // Build title bar
    const title = " Session Preview ";
    const topBorder = `╭${title}${"─".repeat(Math.max(0, innerW - visibleWidth(title)))}╮`;
    const bottomBorder = `╰${"─".repeat(innerW)}╯`;

    // Build info line (date always; scroll hints when scrollable)
    const session = this.sessionByPath.get(selectedPath);
    const ts = session?.modified ? formatTimestamp(session.modified) : "";
    const tsStyled = ts ? this.theme.fg("muted", ts) : "";
    const availableW = innerW - 2;

    let infoContent = "";
    if (needsScroll) {
      const help = this.theme.fg("dim", HELP_TEXT);
      if (tsStyled) {
        const tsW = visibleWidth(tsStyled);
        const helpW = visibleWidth(help);
        if (helpW + 2 + tsW <= availableW) {
          const gap = availableW - helpW - tsW;
          infoContent = `${help}${" ".repeat(gap)}${tsStyled}`;
        } else {
          const helpMaxW = Math.max(0, availableW - tsW - 2);
          infoContent = `${truncateToWidth(help, helpMaxW)}  ${tsStyled}`;
        }
      } else {
        infoContent = truncateToWidth(help, availableW);
      }
    } else if (tsStyled) {
      const tsW = visibleWidth(tsStyled);
      const gap = Math.max(0, availableW - tsW);
      infoContent = `${" ".repeat(gap)}${tsStyled}`;
    }

    const padLine = (line: string): string => {
      const t = truncateToWidth(line, innerW - 2);
      const pad = Math.max(0, innerW - 2 - visibleWidth(t));
      return `${this.theme.fg("muted", "│")} ${t}${" ".repeat(pad)} ${this.theme.fg("muted", "│")}`;
    };
    const emptyLine = `${this.theme.fg("muted", "│")}${" ".repeat(innerW)}${this.theme.fg("muted", "│")}`;

    if (!needsScroll) {
      // Content fits: top border, pad, content, pad, info, bottom border
      const result: string[] = [
        this.theme.fg("muted", topBorder),
        emptyLine,
        ...allLines.map(padLine),
        emptyLine,
      ];
      if (infoContent) result.push(padLine(infoContent));
      result.push(this.theme.fg("muted", bottomBorder));
      return result;
    }

    // Scrollable: top border, lines-above, content, lines-below, info, bottom border
    // Content lines = maxHeight - 5 (top border, above-ind, below-ind, info, bottom border)
    const contentLines = Math.max(1, maxHeight - 5);
    const clamped = clampScroll(
      this.scrollFromBottom,
      allLines.length,
      contentLines,
    );
    this.scrollFromBottom = clamped;
    const maxOffset = Math.max(0, allLines.length - contentLines);
    const start = Math.max(0, maxOffset - clamped);
    const end = Math.min(allLines.length, start + contentLines);
    const visible = allLines.slice(start, end);

    const above = start;
    const below = allLines.length - end;
    const aboveInd =
      above > 0 ? this.theme.fg("muted", `… ${above} line(s) above`) : "";
    const belowInd =
      below > 0 ? this.theme.fg("muted", `… ${below} line(s) below`) : "";

    return [
      this.theme.fg("muted", topBorder),
      padLine(aboveInd),
      ...visible.map(padLine),
      padLine(belowInd),
      padLine(infoContent),
      this.theme.fg("muted", bottomBorder),
    ];
  }
}

// ── Selector Wrapper (Focusable, replaces editor) ──

class ResumexSelector implements Focusable {
  private selector: SessionSelectorComponent;
  private preview: PreviewPane;
  private requestRender: () => void;
  lastSelectorHeight = 0;

  _focused = false;
  get focused(): boolean {
    return this._focused;
  }
  set focused(v: boolean) {
    this._focused = v;
    this.selector.focused = v;
  }

  constructor(
    selector: SessionSelectorComponent,
    preview: PreviewPane,
    requestRender: () => void,
  ) {
    this.selector = selector;
    this.preview = preview;
    this.requestRender = requestRender;
  }

  handleInput(data: string): void {
    if (this.preview.handleScrollInput(data)) return;
    this.selector.handleInput(data);
    this.requestRender();
  }

  render(width: number): string[] {
    // Update preview's selected path
    const path = this.selector.getSessionList().getSelectedSessionPath();
    this.preview.setSelectedPath(path);

    const lines = this.selector.render(width);
    this.lastSelectorHeight = lines.length;
    return lines;
  }

  invalidate(): void {
    this.selector.invalidate();
  }

  dispose(): void {
    (this.selector as any).dispose();
  }
}

// ── openResumexPicker ──

export async function openResumexPicker(
  pi: ExtensionAPI,
  ctx: ResumexPickerContext,
): Promise<ResumexPickerResult> {
  if (!ctx.hasUI) {
    return { kind: "dismissed", reason: "cancel" };
  }

  const currentCwd = ctx.cwd;
  const currentSessionFilePath = ctx.sessionManager.getSessionFile();
  const sessionByPath = new Map<string, SessionInfo>();
  const recordSessions = (sessions: SessionInfo[]) => {
    for (const session of sessions) {
      sessionByPath.set(session.path, session);
    }
  };

  const currentSessionsLoader = async (
    onProgress?: (loaded: number, total: number) => void,
  ) => {
    const sessions = await SessionManager.list(
      currentCwd,
      undefined,
      onProgress,
    );
    const bumped = bumpModifiedByRenames(sessions);
    recordSessions(bumped);
    return bumped;
  };

  const allSessionsLoader = async (
    onProgress?: (loaded: number, total: number) => void,
  ) => {
    const sessions = await SessionManager.listAll(onProgress);
    const bumped = bumpModifiedByRenames(sessions);
    recordSessions(bumped);
    return bumped;
  };

  return ctx.ui.custom<ResumexPickerResult>((tui, theme, _kb, done) => {
    const finish = (result: ResumexPickerResult) => {
      ctx.ui.setWidget("resumex.preview", undefined);
      done(result);
    };

    const selector = new SessionSelectorComponent(
      currentSessionsLoader,
      allSessionsLoader,
      (sessionPath) => finish({ kind: "selected", sessionPath }),
      () => finish({ kind: "dismissed", reason: "cancel" }),
      () => finish({ kind: "dismissed", reason: "exit" }),
      () => tui.requestRender(),
      {
        showRenameHint: true,
        renameSession: async (
          sessionPath: string,
          newName: string | undefined,
        ) => {
          const name = (newName ?? "").trim();
          if (!name) return;
          trackRename(sessionPath);
          if (
            currentSessionFilePath &&
            sessionPath === currentSessionFilePath
          ) {
            pi.setSessionName(name);
          } else {
            const manager = SessionManager.open(sessionPath);
            manager.appendSessionInfo(name);
          }
        },
      },
      currentSessionFilePath,
    );

    const sl = selector.getSessionList();

    // ── Loading state fix ──
    const origLoad = (selector as any).loadCurrentSessions;
    if (typeof origLoad === "function") {
      (selector as any).loadCurrentSessions = function (this: any) {
        this.currentLoading = true;
        this.header?.setLoading(true);
        this.requestRender?.();
        setImmediate(() => void origLoad.call(this));
      };
    }

    // ── Auto-select current session ──
    let hasInitialSelected = false;
    const origSetSessions = sl.setSessions;
    sl.setSessions = function (
      this: any,
      sessions: SessionInfo[],
      showCwd: boolean,
    ) {
      origSetSessions.call(this, sessions, showCwd);
      if (!this.searchInput.getValue() && !hasInitialSelected) {
        const idx = this.filteredSessions.findIndex((s: any) =>
          this.isCurrentSessionPath(s.session.path),
        );
        if (idx !== -1) {
          this.selectedIndex = idx;
          hasInitialSelected = true;
        }
      }
    };

    // ── Auto-select renamed session ──
    const origConfirmRename = (selector as any).confirmRename;
    if (typeof origConfirmRename === "function") {
      (selector as any).confirmRename = async function (
        this: any,
        value: string,
      ) {
        const target = this.renameTargetPath;
        await origConfirmRename.call(this, value);
        if (target && this.sessionList?.filteredSessions) {
          const idx = this.sessionList.filteredSessions.findIndex(
            (s: any) => s.session.path === target,
          );
          if (idx !== -1) {
            this.sessionList.selectedIndex = idx;
            this.requestRender?.();
          }
        }
      };
    }

    // ── Allow deleting active session ──
    (sl as any).startDeleteConfirmationForSelectedSession = function (
      this: any,
    ) {
      const selected = this.filteredSessions[this.selectedIndex];
      if (!selected) return;
      this.setConfirmingDeletePath(selected.session.path);
    };

    const origOnDelete = sl.onDeleteSession;
    sl.onDeleteSession = async function (this: any, sessionPath: string) {
      const isCurrent = this.isCurrentSessionPath(sessionPath);
      if (isCurrent) {
        process.stdin.emit("data", Buffer.from("\x03/new\r"));
        await origOnDelete.call(this, sessionPath);
        finish({ kind: "dismissed", reason: "cancel" });
      } else {
        await origOnDelete.call(this, sessionPath);
      }
    };

    // ── Create wrapper ──
    const wrapper = new ResumexSelector(selector, {} as any, () =>
      tui.requestRender(),
    );

    const preview = new PreviewPane({
      sessionByPath,
      getTermHeight: () => tui.terminal?.rows ?? 40,
      getSelectorHeight: () => wrapper.lastSelectorHeight,
      requestRender: () => tui.requestRender(),
      theme,
    });

    // Wire preview into wrapper
    (wrapper as any).preview = preview;

    // ── Show preview as widget above editor ──
    (ctx.ui as any).setWidget(
      "resumex.preview",
      () => ({
        render: (width: number) => {
          const path = selector.getSessionList().getSelectedSessionPath();
          return preview.render(path, width);
        },
      }),
      { placement: "aboveEditor" },
    );

    return wrapper;
  });
}
