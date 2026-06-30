/**
 * Allows deleting the active session from /resume.
 *
 * Bypasses Pi's active-session delete guard, clears into a new session first,
 * then deletes the old active session while keeping the selector open.
 */

function getSessionList(selector: any) {
  return typeof selector.getSessionList === "function"
    ? selector.getSessionList()
    : selector.sessionList;
}

export function patchDeleteActiveSession(selector: any, interactiveMode: any) {
  const sessionList = getSessionList(selector);
  if (!sessionList) return;

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
    } else {
      await originalOnDeleteSession.call(this, sessionPath);
    }
  };
}
