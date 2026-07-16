/**
 * Resume extension entrypoint.
 *
 * Loads Pi internals, installs shared runtime patches, and composes the
 * high-level /resume features around Pi's native session selector.
 */

import { realpathSync, watch, type FSWatcher } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { patchDeleteActiveSession } from "./delete-active-session";
import { patchHighlightCurrentSession } from "./highlight-current-session";
import {
  installOptimizeStartup,
  scheduleResumeSessionSync,
  setResumeSessionScope,
} from "./optimize-startup";
import {
  applyRenameSessionRecent,
  patchRenameSelection,
} from "./rename-session-recent";
import { wrapWithSessionPreview } from "./session-preview";

const RESUME_PATCHED = "__resumePreviewPatched";

const sessionInfoCache = new Map<
  string,
  { mtimeMs: number; size: number; info: any }
>();

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

function scheduleResumeWarm(sessionManager: any, includeAll = true) {
  scheduleResumeSessionSync({
    cwd: sessionManager?.getCwd?.(),
    sessionDir: sessionManager?.getSessionDir?.(),
    usesDefaultSessionDir: sessionManager?.usesDefaultSessionDir?.(),
    includeAll,
  });
}

function watchSessionDir(sessionManager: any) {
  const sessionDir = sessionManager?.getSessionDir?.();
  if (!sessionDir) return undefined;

  let watcher: FSWatcher | undefined;
  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    setImmediate(() => {
      pending = false;
      scheduleResumeWarm(sessionManager, false);
    });
  };

  try {
    watcher = watch(sessionDir, { persistent: false }, (_event, filename) => {
      if (filename && !String(filename).endsWith(".jsonl")) return;
      schedule();
    });
    watcher.on("error", () => {});
  } catch {
    return undefined;
  }

  return () => watcher?.close();
}

function loadPreviewDeps(req: NodeRequire, distPath: string) {
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

  return {
    loadEntriesFromFile,
    getMarkdownTheme,
    theme,
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

export default function (pi: ExtensionAPI) {
  const req = createRequire(__filename);
  const cliPath = realpathSync(process.argv[1]);
  const distPath = dirname(cliPath);

  applyRenameSessionRecent(
    req,
    distPath,
    sessionInfoCache,
    (sessionManager) => {
      scheduleResumeWarm(sessionManager, false);
    },
  );
  installOptimizeStartup(req, distPath, sessionInfoCache);

  let stopWatchingSessionDir: (() => void) | undefined;
  let activeSessionManager: ExtensionContext["sessionManager"] | undefined;

  pi.on("session_start", (_event, ctx) => {
    activeSessionManager = ctx.sessionManager;
    const warm = () => {
      if (activeSessionManager) {
        scheduleResumeWarm(activeSessionManager, false);
      }
    };
    stopWatchingSessionDir?.();
    stopWatchingSessionDir = watchSessionDir(activeSessionManager);
    warm();
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

  pi.on("agent_end", (_event, ctx) => {
    scheduleResumeWarm(ctx.sessionManager, false);
  });

  pi.on("session_shutdown", () => {
    stopWatchingSessionDir?.();
    stopWatchingSessionDir = undefined;
    activeSessionManager = undefined;
  });

  const previewDeps = loadPreviewDeps(req, distPath);
  const { InteractiveMode } = req(
    join(distPath, "modes", "interactive", "interactive-mode.js"),
  );
  const proto = InteractiveMode.prototype as PatchedInteractiveMode;

  if (!proto[RESUME_PATCHED]) {
    const originalShow = proto.showSessionSelector;

    proto.showSessionSelector = function (this: PatchedInteractiveMode) {
      setResumeSessionScope(
        this.sessionManager?.getCwd?.(),
        this.sessionManager?.getSessionDir?.(),
      );

      const originalShowSelector = this.showSelector;

      this.showSelector = function (
        this: PatchedInteractiveMode,
        factory: (done: () => void) => any,
      ) {
        return originalShowSelector.call(this, (done: any) => {
          const doneWithSync = () => {
            try {
              done();
            } finally {
              scheduleResumeWarm(this.sessionManager, false);
            }
          };
          const result = factory(doneWithSync);
          const selector = result.component;

          if (hasSessionList(selector)) {
            patchHighlightCurrentSession(selector, this, doneWithSync);
            patchRenameSelection(selector);
            patchDeleteActiveSession(selector, this);
            const wrapper = wrapWithSessionPreview(selector, this, previewDeps);
            return { ...result, component: wrapper, focus: wrapper };
          }

          return result;
        });
      };

      try {
        return originalShow.call(this);
      } finally {
        setResumeSessionScope(undefined, undefined);
        if (Object.prototype.hasOwnProperty.call(this, "showSelector")) {
          delete (this as any).showSelector;
        }
      }
    };

    proto[RESUME_PATCHED] = true;
  }
}
