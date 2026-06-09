/**
 * Keeps /resume centered on the active session.
 *
 * Selects the current session when the picker opens, resets search results to
 * the first match while typing, and treats selecting the current session as a
 * no-op close instead of switching to itself.
 */

function getSessionList(selector: any) {
  return typeof selector.getSessionList === "function"
    ? selector.getSessionList()
    : selector.sessionList;
}

export function patchHighlightCurrentSession(
  selector: any,
  interactiveMode: any,
  done: () => void,
) {
  const sessionList = getSessionList(selector);
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

  const originalFilterSessions = sessionList.filterSessions;
  if (typeof originalFilterSessions === "function") {
    sessionList.filterSessions = function (this: any, query: string) {
      originalFilterSessions.call(this, query);
      if (String(query ?? "").trim()) {
        this.selectedIndex = 0;
      }
    };
  }

  const originalOnSelect = sessionList.onSelect;
  sessionList.onSelect = function (this: any, sessionPath: string) {
    if (this.isCurrentSessionPath?.(sessionPath)) {
      done();
      interactiveMode.ui?.requestRender?.();
      return;
    }
    return originalOnSelect?.call(this, sessionPath);
  };
}
