/**
 * Resume extension entrypoint.
 *
 * Loads Pi internals, installs shared runtime patches, and composes the
 * high-level /resume features around Pi's native session selector.
 */

import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { patchDeleteActiveSession } from "./delete-active-session";
import { patchHighlightCurrentSession } from "./highlight-current-session";
import {
  installOptimizeStartup,
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

export default function (_pi: ExtensionAPI) {
  const req = createRequire(__filename);
  const cliPath = realpathSync(process.argv[1]);
  const distPath = dirname(cliPath);

  applyRenameSessionRecent(req, distPath, sessionInfoCache);
  installOptimizeStartup(req, distPath, sessionInfoCache);

  const previewDeps = loadPreviewDeps(req, distPath);
  const { InteractiveMode } = req(
    join(distPath, "modes", "interactive", "interactive-mode.js"),
  );
  const proto = InteractiveMode.prototype as PatchedInteractiveMode;
  const patchState = proto[RESUME_PATCHED];

  if (!patchState) {
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
          const result = factory(done);
          const selector = result.component;

          if (hasSessionList(selector)) {
            patchHighlightCurrentSession(selector, this, done);
            patchRenameSelection(selector);
            patchDeleteActiveSession(selector, this, done);
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

    proto[RESUME_PATCHED] = { originalShow };
  }
}
