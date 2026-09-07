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

  const selectInitial = (list: any) => {
    if (list.searchInput.getValue()) return false;
    const idx = list.filteredSessions.findIndex((entry: any) =>
      list.isCurrentSessionPath?.(entry.session.path),
    );
    if (idx >= 0) {
      list.selectedIndex = idx;
      return true;
    }
    if (list.filteredSessions.length === 0) return false;
    list.selectedIndex = 0;
    return true;
  };

  const originalSetSessions = sessionList.setSessions;
  let hasInitialSelected = selectInitial(sessionList);

  sessionList.setSessions = function (
    this: any,
    sessions: any[],
    showCwd: boolean,
  ) {
    originalSetSessions.call(this, sessions, showCwd);

    if (!hasInitialSelected) hasInitialSelected = selectInitial(this);
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
