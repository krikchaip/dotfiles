/**
 * Resume extension entrypoint.
 *
 * Loads Pi internals, installs shared runtime patches, and composes the
 * high-level /resume features around Pi's native session selector.
 */

import { readFileSync, watch, type FSWatcher } from "node:fs";
import { resolve } from "node:path";
import {
  AssistantMessageComponent,
  BashExecutionComponent,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  CustomMessageComponent,
  getMarkdownTheme,
  InteractiveMode,
  SessionManager,
  SessionSelectorComponent,
  UserMessageComponent,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { patchDeleteActiveSession } from "./delete-active-session";
import { patchHighlightCurrentSession } from "./highlight-current-session";
import { patchSessionTreeFirstIndent } from "./session-tree-indent";
import {
  getResumeDefaultSessionDir,
  guardResumeSelection,
  installOptimizeStartup,
  invalidateResumeSessionDir,
  primeResumeSessionCatalog,
  releaseResumeSelector,
  scheduleResumeSessionSync,
  setResumeActiveSessionManager,
  setResumeSessionScope,
} from "./optimize-startup";
import {
  applyRenameSessionRecent,
  patchRenameSelection,
} from "./rename-session-recent";
import { ResumeCatalog } from "./session-catalog";
import { wrapWithSessionPreview } from "./session-preview";
import {
  advertiseTmuxSession,
  clearTmuxSessionAdvertisement,
  isTmuxResumeSplitAvailable,
  patchTmuxSessionSplit,
} from "./tmux-session-split";

const RESUME_PATCHED = "__resumePreviewPatched";
const RESUME_INPUT_ACTIVE = "__resumeInputActive";

interface PatchedInteractiveMode {
  showSessionSelector(): void;
  showSelector(factory: (done: () => void) => any): any;
  [key: string]: any;
}

function hasSessionList(selector: any) {
  return (
    selector?.sessionList || typeof selector?.getSessionList === "function"
  );
}

function scheduleResumeWarm() {
  scheduleResumeSessionSync();
}

function watchSessionDir(sessionManager: any) {
  const sessionDir = sessionManager?.getSessionDir?.();
  if (!sessionDir) return undefined;

  let watcher: FSWatcher | undefined;

  try {
    watcher = watch(sessionDir, { persistent: false }, (_event, filename) => {
      if (filename && !String(filename).endsWith(".jsonl")) return;
      invalidateResumeSessionDir(
        sessionDir,
        filename ? String(filename) : undefined,
      );
    });
    watcher.on("error", () => {});
  } catch {
    return undefined;
  }

  return () => watcher?.close();
}

const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");

const activeTheme = new Proxy({} as any, {
  get(_target, prop) {
    const theme = (globalThis as any)[THEME_KEY];
    if (!theme) throw new Error("Theme not initialized");
    return theme[prop];
  },
});

function loadEntriesFromFile(path: string) {
  try {
    const entries = readFileSync(path, "utf8")
      .split("\n")
      .flatMap((line) => {
        if (!line.trim()) return [];
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
    const header = entries[0];
    return header?.type === "session" && typeof header.id === "string"
      ? entries
      : [];
  } catch {
    return [];
  }
}

function loadPreviewDeps() {
  return {
    loadEntriesFromFile,
    getMarkdownTheme,
    theme: activeTheme,
    components: {
      AssistantMessageComponent,
      BashExecutionComponent,
      BranchSummaryMessageComponent,
      CompactionSummaryMessageComponent,
      CustomMessageComponent,
      UserMessageComponent,
    },
  };
}

const catalog = new ResumeCatalog();

export default function (pi: ExtensionAPI) {
  applyRenameSessionRecent(SessionManager, catalog);
  installOptimizeStartup(SessionSelectorComponent, catalog);

  const tmuxSplitAvailable = isTmuxResumeSplitAvailable();
  let stopWatchingSessionDir: (() => void) | undefined;
  let activeSessionManager: ExtensionContext["sessionManager"] | undefined;

  pi.on("session_start", (_event, ctx) => {
    activeSessionManager = ctx.sessionManager;
    setResumeActiveSessionManager(activeSessionManager);
    const cwd = ctx.sessionManager.getCwd();
    const sessionDir = ctx.sessionManager.getSessionDir();
    setResumeSessionScope(
      cwd,
      sessionDir,
      resolve(sessionDir) === resolve(getResumeDefaultSessionDir(cwd)),
    );
    if (tmuxSplitAvailable && ctx.mode === "tui") {
      advertiseTmuxSession(ctx.sessionManager.getSessionFile());
    }
    const warm = () => {
      if (activeSessionManager) scheduleResumeWarm();
    };
    stopWatchingSessionDir?.();
    stopWatchingSessionDir = watchSessionDir(activeSessionManager);
    primeResumeSessionCatalog();
    ctx.ui.addAutocompleteProvider((current: any) => ({
      triggerCharacters: [
        ...new Set([...(current.triggerCharacters ?? []), "/"]),
      ],
      async getSuggestions(
        lines: string[],
        cursorLine: number,
        cursorCol: number,
        options: any,
      ) {
        const line = lines[cursorLine] ?? "";
        const beforeCursor = line.slice(0, cursorCol);
        if (beforeCursor.trimStart().startsWith("/")) warm();
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      },
      applyCompletion(
        lines: string[],
        cursorLine: number,
        cursorCol: number,
        item: any,
        prefix: string,
      ) {
        return current.applyCompletion(
          lines,
          cursorLine,
          cursorCol,
          item,
          prefix,
        );
      },
      shouldTriggerFileCompletion(
        lines: string[],
        cursorLine: number,
        cursorCol: number,
      ) {
        return (
          current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ??
          true
        );
      },
    }));
  });

  pi.on("agent_end", () => {
    scheduleResumeWarm();
  });

  pi.on("session_shutdown", (event) => {
    if (tmuxSplitAvailable) clearTmuxSessionAdvertisement();
    stopWatchingSessionDir?.();
    stopWatchingSessionDir = undefined;
    activeSessionManager = undefined;
    setResumeActiveSessionManager(undefined);
    setResumeSessionScope(undefined, undefined);
    if (event.reason === "reload" || event.reason === "quit") {
      void catalog.close();
    }
  });

  const previewDeps = loadPreviewDeps();
  const proto = InteractiveMode.prototype as unknown as PatchedInteractiveMode;

  if (!proto[RESUME_PATCHED]) {
    const originalShow = proto.showSessionSelector;
    const originalAddTerminalInputListener =
      proto.addExtensionTerminalInputListener;

    if (typeof originalAddTerminalInputListener === "function") {
      proto.addExtensionTerminalInputListener = function (
        this: PatchedInteractiveMode,
        handler: (data: string) => unknown,
      ) {
        return originalAddTerminalInputListener.call(this, (data: string) =>
          this[RESUME_INPUT_ACTIVE] ? undefined : handler(data),
        );
      };
    }

    proto.showSessionSelector = function (this: PatchedInteractiveMode) {
      setResumeActiveSessionManager(this.sessionManager);
      setResumeSessionScope(
        this.sessionManager?.getCwd?.(),
        this.sessionManager?.getSessionDir?.(),
        this.sessionManager?.usesDefaultSessionDir?.(),
      );

      const originalShowSelector = this.showSelector;

      this.showSelector = function (
        this: PatchedInteractiveMode,
        factory: (done: () => void) => any,
      ) {
        return originalShowSelector.call(this, (done: any) => {
          let restoreResumeLayout: (() => void) | undefined;
          let selector: any;
          const doneWithSync = () => {
            try {
              restoreResumeLayout?.();
              done();
            } finally {
              releaseResumeSelector(selector);
              this[RESUME_INPUT_ACTIVE] = false;
              scheduleResumeWarm();
            }
          };
          const result = factory(doneWithSync);
          selector = result.component;

          if (!hasSessionList(selector)) return result;

          this[RESUME_INPUT_ACTIVE] = true;
          try {
            patchHighlightCurrentSession(selector, this, doneWithSync);
            patchSessionTreeFirstIndent(selector);
            guardResumeSelection(selector);
            patchRenameSelection(selector, this);
            patchDeleteActiveSession(selector, this);
            if (tmuxSplitAvailable) {
              patchTmuxSessionSplit(
                selector,
                this,
                doneWithSync,
                previewDeps.theme,
              );
            }
            const wrapper = wrapWithSessionPreview(
              selector,
              this,
              doneWithSync,
              previewDeps,
            );
            restoreResumeLayout = () => wrapper.restoreLayout();
            return { ...result, component: wrapper, focus: wrapper };
          } catch (error) {
            this[RESUME_INPUT_ACTIVE] = false;
            throw error;
          }
        });
      };

      try {
        return originalShow.call(this);
      } finally {
        if (Object.prototype.hasOwnProperty.call(this, "showSelector")) {
          delete (this as any).showSelector;
        }
      }
    };

    proto[RESUME_PATCHED] = true;
  }
}
