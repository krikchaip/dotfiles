/**
 * Patch /resume
 *
 * Monkey-patches InteractiveMode's native session selector at runtime so that:
 * 1. The currently active session is selected by default when opening `/resume`.
 * 2. Deleting the active session is permitted (clears screen + starts new session).
 * 3. Renaming a session bumps modified time so it jumps to top.
 * 4. Selected session preview renders below the native picker.
 */

import { closeSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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

// ─── Internal constants ─────────────────────────────────────────────────────

const RESUME_PATCHED = "__resumePreviewPatched";
const RESUME_PATCH_VERSION = 6;
const RENAME_PATCHED = "__renameBumpPatched";
const RENAME_PATCH_VERSION = 4;
const LOAD_PATCHED = "__resumeSnapPatched";

/** Bytes read from tail of session file when scanning for session_info name. */
const SESSION_INFO_TAIL_BYTES = 256 * 1024;

const renameTimestamps = new Map<string, number>();
const sessionInfoTimestampCache = new Map<
  string,
  { mtimeMs: number; size: number; timestamp: number | undefined }
>();

// SessionInfo cache: avoids re-reading/parsing unchanged JSONL files on each /resume.
const sessionInfoCache = new Map<
  string,
  { mtimeMs: number; size: number; info: any }
>();

// Module-level vars set during showSessionSelector so the sync cache path
// in loadCurrentSessions can locate the session directory without async.
let _resumeCwd: string | undefined;
let _resumeSessionDir: string | undefined;

interface PatchedInteractiveMode {
  showSessionSelector(): void;
  showSelector(factory: (done: () => void) => any): any;
  [key: string]: any;
}

function latestSessionInfoTimestamp(sessionPath: string) {
  try {
    const st = statSync(sessionPath);
    const cached = sessionInfoTimestampCache.get(sessionPath);
    if (cached?.mtimeMs === st.mtimeMs && cached.size === st.size) {
      return cached.timestamp;
    }

    let timestamp: number | undefined;
    const fd = openSync(sessionPath, "r");
    try {
      const length = Math.min(st.size, SESSION_INFO_TAIL_BYTES);
      const start = Math.max(0, st.size - length);
      const buffer = Buffer.alloc(length);
      const bytesRead = readSync(fd, buffer, 0, length, start);
      const content = buffer.toString("utf8", 0, bytesRead);
      const lines = content.split("\n");
      if (start > 0) lines.shift();

      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line.includes("session_info")) continue;
        try {
          const entry = JSON.parse(line);
          if (entry?.type !== "session_info") continue;
          const t = Date.parse(entry.timestamp);
          if (!Number.isNaN(t)) {
            timestamp = t;
            break;
          }
        } catch {
          // Ignore malformed JSONL lines, matching core session loader behavior.
        }
      }
    } finally {
      closeSync(fd);
    }

    sessionInfoTimestampCache.set(sessionPath, {
      mtimeMs: st.mtimeMs,
      size: st.size,
      timestamp,
    });
    return timestamp;
  } catch {
    return undefined;
  }
}

function applyRenameBumpPatch(req: NodeRequire, distPath: string) {
  const { SessionManager } = req(join(distPath, "core", "session-manager.js"));
  const patchState = (SessionManager.prototype as any)[RENAME_PATCHED];

  if (!patchState) {
    (SessionManager.prototype as any)[RENAME_PATCHED] = {
      version: RENAME_PATCH_VERSION,
    };

    const origAppend = SessionManager.prototype.appendSessionInfo;
    SessionManager.prototype.appendSessionInfo = function (name: string) {
      const id = origAppend.call(this, name);
      const sf = this.getSessionFile();
      if (sf) renameTimestamps.set(sf, Date.now());
      return id;
    };

    const bumpModified = (sessions: any[]) =>
      sessions
        .map((s) => {
          const t = Math.max(
            renameTimestamps.get(s.path) ?? 0,
            s.name ? (latestSessionInfoTimestamp(s.path) ?? 0) : 0,
          );
          return t && t > s.modified.getTime()
            ? { ...s, modified: new Date(t) }
            : s;
        })
        .sort((a, b) => b.modified.getTime() - a.modified.getTime());

    const origList = SessionManager.list;
    const { getDefaultSessionDir } = req(
      join(distPath, "core", "session-manager.js"),
    );
    const { readdir } = req("node:fs/promises");

    SessionManager.list = async function (
      cwd: string,
      sessionDir?: string,
      onProgress?: any,
    ) {
      // Fast path: check if all files in dir are cached and unchanged
      const dir = sessionDir ? sessionDir : getDefaultSessionDir(cwd);

      try {
        const dirEntries = await readdir(dir);
        const files = dirEntries
          .filter((f: string) => f.endsWith(".jsonl"))
          .map((f: string) => join(dir, f));

        let allCached = true;
        const cachedSessions: any[] = [];

        for (const filePath of files) {
          try {
            const st = statSync(filePath);
            const cached = sessionInfoCache.get(filePath);
            if (
              cached &&
              cached.mtimeMs === st.mtimeMs &&
              cached.size === st.size
            ) {
              cachedSessions.push(cached.info);
            } else {
              allCached = false;
              break;
            }
          } catch {
            allCached = false;
            break;
          }
        }

        if (allCached && files.length > 0) {
          onProgress?.(files.length, files.length);
          return bumpModified(cachedSessions);
        }
      } catch {
        // fall through to full load
      }

      const sessions: any[] = await origList(cwd, sessionDir, onProgress);
      const bumped = bumpModified(sessions);
      for (const s of bumped) {
        if (!s?.path) continue;
        try {
          const st = statSync(s.path);
          sessionInfoCache.set(s.path, {
            mtimeMs: st.mtimeMs,
            size: st.size,
            info: s,
          });
        } catch {
          // ignore
        }
      }
      return bumped;
    };

    const origListAll = SessionManager.listAll;
    SessionManager.listAll = async function (onProgress?: any) {
      const sessions: any[] = await origListAll(onProgress);
      const bumped = bumpModified(sessions);
      for (const s of bumped) {
        if (!s?.path) continue;
        try {
          const st = statSync(s.path);
          sessionInfoCache.set(s.path, {
            mtimeMs: st.mtimeMs,
            size: st.size,
            info: s,
          });
        } catch {
          // ignore
        }
      }
      return bumped;
    };
  } else if (patchState.version !== RENAME_PATCH_VERSION) {
    patchState.version = RENAME_PATCH_VERSION;
  }

  return SessionManager;
}

function shortenPath(path: string | undefined) {
  if (!path) return "";
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
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
    private readonly loadEntriesFromFile: (path: string) => any[],
    private readonly components: any,
  ) {}

  private markdownTheme() {
    return (
      this.interactiveMode.getMarkdownThemeWithSettings?.() ??
      this.interactiveMode.__resumePreviewMarkdownTheme
    );
  }

  private entries(session: any) {
    const path = session?.path;
    if (!path) return [];

    try {
      const mtimeMs = statSync(path).mtimeMs;
      const cached = this.entryCache.get(path);
      if (cached?.mtimeMs === mtimeMs) return cached.entries;

      const entries = this.loadEntriesFromFile(path);
      this.entryCache.set(path, { mtimeMs, entries });
      return entries;
    } catch {
      return [];
    }
  }

  private renderEntry(entry: any, width: number) {
    const markdownTheme = this.markdownTheme();

    if (entry.type === "message") {
      const message = entry.message;
      if (message?.role === "user") {
        return new this.components.UserMessageComponent(
          textContent(message.content),
          markdownTheme,
        ).render(width);
      }
      if (message?.role === "assistant") {
        return new this.components.AssistantMessageComponent(
          normalizeAssistantMessage(message),
          this.interactiveMode.hideThinkingBlock,
          markdownTheme,
          this.interactiveMode.hiddenThinkingLabel,
        ).render(width);
      }
      if (message?.role === "bashExecution") {
        const component = new this.components.BashExecutionComponent(
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
      const component = new this.components.CompactionSummaryMessageComponent(
        entry,
        markdownTheme,
      );
      component.setExpanded(true);
      return component.render(width);
    }

    if (entry.type === "branch_summary") {
      const component = new this.components.BranchSummaryMessageComponent(
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
      const component = new this.components.CustomMessageComponent(
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
      this.theme.fg("muted", `${session?.messageCount ?? 0} msgs`),
      this.theme.fg("muted", formatDate(session?.modified)),
    ];

    const loc = shortenPath(session?.cwd || session?.path);
    if (loc) parts.push(this.theme.fg("muted", loc));

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
  ) {
    const renderer = new SessionEntryRenderer(
      this.interactiveMode,
      this.interactiveMode.__resumePreviewLoadEntriesFromFile,
      this.interactiveMode.__resumePreviewComponents,
    );

    this.preview = new ResumePreviewPane(
      () => this.interactiveMode.ui?.terminal?.rows ?? 40,
      this.interactiveMode.__resumePreviewTheme,
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

function patchSelectorInstance(
  selector: any,
  interactiveMode: any,
  done: () => void,
) {
  const sessionList =
    typeof selector.getSessionList === "function"
      ? selector.getSessionList()
      : selector.sessionList;
  if (!sessionList) return;

  const originalSetSessions = sessionList.setSessions;
  let hasInitialSelected = false;

  sessionList.setSessions = function (
    this: any,
    sessions: any[],
    showCwd: boolean,
  ) {
    originalSetSessions.call(this, sessions, showCwd);

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

  const originalConfirmRename = selector.confirmRename;
  if (typeof originalConfirmRename === "function") {
    selector.confirmRename = async function (this: any, value: string) {
      const target = this.renameTargetPath;
      await originalConfirmRename.call(this, value);
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

  const originalOnDeleteSession = sessionList.onDeleteSession;

  sessionList.startDeleteConfirmationForSelectedSession = function (this: any) {
    const selected = this.filteredSessions[this.selectedIndex];
    if (!selected) return;
    this.setConfirmingDeletePath(selected.session.path);
  };

  sessionList.onDeleteSession = async function (
    this: any,
    sessionPath: string,
  ) {
    const isCurrent = this.isCurrentSessionPath(sessionPath);

    if (isCurrent) {
      await interactiveMode.handleClearCommand();
      await originalOnDeleteSession.call(this, sessionPath);
      done();
    } else {
      await originalOnDeleteSession.call(this, sessionPath);
    }
  };
}

export default function (_pi: ExtensionAPI) {
  const req = createRequire(__filename);
  const cliPath = realpathSync(process.argv[1]);
  const distPath = dirname(cliPath);

  applyRenameBumpPatch(req, distPath);

  const { loadEntriesFromFile } = req(
    join(distPath, "core", "session-manager.js"),
  );
  const { getMarkdownTheme, theme } = req(
    join(distPath, "modes", "interactive", "theme", "theme.js"),
  );
  const { AssistantMessageComponent } = req(
    join(
      distPath,
      "modes",
      "interactive",
      "components",
      "assistant-message.js",
    ),
  );
  const { BashExecutionComponent } = req(
    join(distPath, "modes", "interactive", "components", "bash-execution.js"),
  );
  const { BranchSummaryMessageComponent } = req(
    join(
      distPath,
      "modes",
      "interactive",
      "components",
      "branch-summary-message.js",
    ),
  );
  const { CompactionSummaryMessageComponent } = req(
    join(
      distPath,
      "modes",
      "interactive",
      "components",
      "compaction-summary-message.js",
    ),
  );
  const { CustomMessageComponent } = req(
    join(distPath, "modes", "interactive", "components", "custom-message.js"),
  );
  const { UserMessageComponent } = req(
    join(distPath, "modes", "interactive", "components", "user-message.js"),
  );
  const resumePreviewComponents = {
    AssistantMessageComponent,
    BashExecutionComponent,
    BranchSummaryMessageComponent,
    CompactionSummaryMessageComponent,
    CustomMessageComponent,
    UserMessageComponent,
  };
  const { InteractiveMode } = req(
    join(distPath, "modes", "interactive", "interactive-mode.js"),
  );
  const proto = InteractiveMode.prototype as PatchedInteractiveMode;
  const patchState = proto[RESUME_PATCHED];

  if (!patchState || patchState.version !== RESUME_PATCH_VERSION) {
    const originalShow = patchState?.originalShow ?? proto.showSessionSelector;

    proto.showSessionSelector = function (this: PatchedInteractiveMode) {
      this.__resumePreviewTheme = theme;
      this.__resumePreviewMarkdownTheme = getMarkdownTheme();
      this.__resumePreviewLoadEntriesFromFile = loadEntriesFromFile;
      this.__resumePreviewComponents = resumePreviewComponents;

      // Set module-level vars so sync cache path in loadCurrentSessions works.
      _resumeCwd = this.sessionManager?.getCwd?.();
      _resumeSessionDir = this.sessionManager?.getSessionDir?.();

      const originalShowSelector = this.showSelector;

      this.showSelector = function (
        this: PatchedInteractiveMode,
        factory: (done: () => void) => any,
      ) {
        return originalShowSelector.call(this, (done: any) => {
          const result = factory(done);
          const selector = result.component;

          if (
            selector?.sessionList ||
            typeof selector?.getSessionList === "function"
          ) {
            patchSelectorInstance(selector, this, done);
            const wrapper = new ResumeSelectorWithPreview(selector, this);
            return { ...result, component: wrapper, focus: wrapper };
          }

          return result;
        });
      };

      try {
        return originalShow.call(this);
      } finally {
        _resumeCwd = undefined;
        _resumeSessionDir = undefined;
        if (Object.prototype.hasOwnProperty.call(this, "showSelector")) {
          delete (this as any).showSelector;
        }
      }
    };

    proto[RESUME_PATCHED] = { version: RESUME_PATCH_VERSION, originalShow };
  }

  const { SessionSelectorComponent } = req(
    join(distPath, "modes", "interactive", "components", "session-selector.js"),
  );
  const selectorProto = SessionSelectorComponent.prototype as any;

  if (!selectorProto[LOAD_PATCHED]) {
    const originalLoadCurrentSessions = selectorProto.loadCurrentSessions;
    const { getDefaultSessionDir } = req(
      join(distPath, "core", "session-manager.js"),
    );
    const { readdirSync } = req("node:fs") as typeof import("node:fs");

    selectorProto.loadCurrentSessions = function (this: any) {
      // Fast path: if we have cached SessionInfo for files in this dir,
      // show them immediately (even if slightly stale for active session).
      // Then kick off a background refresh to correct any stale entries.
      if (_resumeCwd) {
        try {
          const dir = _resumeSessionDir ?? getDefaultSessionDir(_resumeCwd);
          const dirEntries: string[] = readdirSync(dir);
          const files = dirEntries
            .filter((f: string) => f.endsWith(".jsonl"))
            .map((f: string) => join(dir, f));

          if (files.length > 0) {
            const cachedSessions: any[] = [];
            let hitCount = 0;

            for (const filePath of files) {
              const cached = sessionInfoCache.get(filePath);
              if (cached?.info) {
                cachedSessions.push(cached.info);
                hitCount++;
              }
            }

            // Show cached results if we have most files cached (>50%)
            if (hitCount > files.length / 2) {
              cachedSessions.sort(
                (a, b) => b.modified.getTime() - a.modified.getTime(),
              );
              this.currentSessions = cachedSessions;
              this.currentLoading = false;
              this.header?.setLoading(false);
              this.sessionList?.setSessions(cachedSessions, false);
              this.requestRender?.();

              // Background refresh to update stale entries silently.
              // Suppress progress/loading indicators by patching header temporarily.
              setImmediate(() => {
                const header = this.header;
                const origSetLoading = header?.setLoading;
                const origSetProgress = header?.setProgress;
                if (header) {
                  header.setLoading = () => {};
                  header.setProgress = () => {};
                }
                const origRequestRender = this.requestRender;
                let loadDone = false;
                this.requestRender = () => {
                  if (loadDone) origRequestRender?.();
                };

                const origLoadScope = this.loadScope;
                this.loadScope = async function (
                  this: any,
                  scope: string,
                  reason: string,
                ) {
                  await origLoadScope.call(this, scope, reason);
                  // Restore
                  loadDone = true;
                  if (header) {
                    header.setLoading = origSetLoading;
                    header.setProgress = origSetProgress;
                    header.setLoading(false);
                  }
                  this.requestRender = origRequestRender;
                  delete this.loadScope;
                  this.requestRender?.();
                };

                void originalLoadCurrentSessions.call(this);
              });
              return;
            }
          }
        } catch {
          // fall through to normal async load
        }
      }

      this.currentLoading = true;
      this.header?.setLoading(true);
      this.requestRender?.();
      setImmediate(() => {
        void originalLoadCurrentSessions.call(this);
      });
    };

    selectorProto[LOAD_PATCHED] = true;
  }
}
