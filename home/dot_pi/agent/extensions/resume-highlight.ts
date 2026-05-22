/**
 * Resume Highlight
 *
 * Monkey-patches InteractiveMode's session selector at runtime so that the
 * currently active session is selected by default when opening `/resume`.
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { realpathSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Minimal interface for the parts of InteractiveMode we hook into
interface PatchedInteractiveMode {
  showSessionSelector(): void;
  showSelector(factory: (done: () => void) => any): any;
  __patched?: boolean;
}

export default function (_pi: ExtensionAPI) {
  // Use createRequire for robust module resolution inside ES modules
  // @ts-ignore
  const req = createRequire(import.meta.url || __filename);

  // Resolve the internal CLI path dynamically to reach the compiled interactive mode package
  const cliPath = realpathSync(process.argv[1]);
  const distPath = dirname(cliPath);
  const interactiveModePath = join(
    distPath,
    "modes",
    "interactive",
    "interactive-mode.js",
  );

  const { InteractiveMode } = req(interactiveModePath);
  const proto = InteractiveMode.prototype as PatchedInteractiveMode;

  // Prevent multiple patch applications across session reloads
  if (proto.__patched) {
    return;
  }

  const originalShow = proto.showSessionSelector;

  proto.showSessionSelector = function (this: PatchedInteractiveMode) {
    const originalShowSelector = this.showSelector;

    // Intercept `showSelector` to wrap the component factory injected by `/resume`
    this.showSelector = function (
      this: PatchedInteractiveMode,
      factory: (done: () => void) => any,
    ) {
      return originalShowSelector.call(this, (done: any) => {
        const result = factory(done);
        const selector = result.component;

        // Verify it is the SessionSelectorComponent containing a SessionList
        if (selector?.sessionList) {
          const originalSetSessions = selector.sessionList.setSessions;

          // Override setSessions to adjust the selected index after items load
          selector.sessionList.setSessions = function (
            this: any,
            sessions: any[],
            showCwd: boolean,
          ) {
            originalSetSessions.call(this, sessions, showCwd);

            // Only auto-highlight if the user hasn't typed a search query
            if (!this.searchInput.getValue()) {
              const idx = this.filteredSessions.findIndex((s: any) =>
                this.isCurrentSessionPath(s.session.path),
              );

              if (idx !== -1) {
                this.selectedIndex = idx;
              }
            }
          };

          const originalOnDeleteSession = selector.sessionList.onDeleteSession;
          const interactiveMode = this as any;

          selector.sessionList.startDeleteConfirmationForSelectedSession = function (
            this: any,
          ) {
            const selected = this.filteredSessions[this.selectedIndex];
            if (!selected) return;

            // Bypass the active session check
            this.setConfirmingDeletePath(selected.session.path);
          };

          selector.sessionList.onDeleteSession = async function (
            this: any,
            sessionPath: string,
          ) {
            const isCurrent = this.isCurrentSessionPath(sessionPath);

            if (isCurrent) {
              // Create a new session (clears screen like /new)
              await interactiveMode.handleClearCommand();

              // Then remove the previously active session
              await originalOnDeleteSession.call(this, sessionPath);

              // Close the session selector
              done();
            } else {
              await originalOnDeleteSession.call(this, sessionPath);
            }
          };
        }

        return result;
      });
    };

    try {
      return originalShow.call(this);
    } finally {
      // Clean up the instance-level shadow method so the prototype method is restored
      if (Object.prototype.hasOwnProperty.call(this, "showSelector")) {
        delete (this as any).showSelector;
      }
    }
  };

  // Mark prototype as patched
  proto.__patched = true;
}
