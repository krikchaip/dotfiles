/**
 * Allows deleting the active session from /resume.
 *
 * Switches to the active session's parent when possible, deletes the old
 * session only after the switch succeeds, and restores the picker state.
 */

import { existsSync } from "node:fs";
import { getKeybindings } from "@earendil-works/pi-tui";

const PENDING_PICKER_STATE = Symbol.for("resume:pending-picker-state");

type PickerState = {
  query: string;
  scope: "current" | "all";
  sortMode: string;
  nameFilter: string;
  showPath: boolean;
  preferredSessionPath?: string;
  deletedSessionPath?: string;
};

function getSessionList(selector: any) {
  return typeof selector.getSessionList === "function"
    ? selector.getSessionList()
    : selector.sessionList;
}

function pendingPickerState(): PickerState | undefined {
  const root = globalThis as any;
  const pending = root[PENDING_PICKER_STATE] as PickerState | undefined;
  delete root[PENDING_PICKER_STATE];
  return pending;
}

function setPendingPickerState(pending: PickerState) {
  (globalThis as any)[PENDING_PICKER_STATE] = pending;
}

function capturePickerState(selector: any, sessionList: any): PickerState {
  return {
    query: sessionList.searchInput?.getValue?.() ?? "",
    scope: selector.scope === "all" ? "all" : "current",
    sortMode: selector.sortMode ?? sessionList.sortMode ?? "threaded",
    nameFilter: selector.nameFilter ?? sessionList.nameFilter ?? "all",
    showPath: Boolean(sessionList.showPath),
  };
}

function restorePickerState(selector: any, sessionList: any) {
  const pending = pendingPickerState();
  if (!pending) return;

  let needsInitialSelection = true;
  const selectPreferredOrFirst = () => {
    if (!needsInitialSelection || selector.scope !== pending.scope) return;
    const loading =
      pending.scope === "all" ? selector.allLoading : selector.currentLoading;
    const preferredIndex = sessionList.filteredSessions?.findIndex(
      (node: any) => node.session?.path === pending.preferredSessionPath,
    );
    if (preferredIndex >= 0) {
      sessionList.selectedIndex = preferredIndex;
      needsInitialSelection = false;
      return;
    }
    if (loading || !sessionList.filteredSessions?.length) return;
    sessionList.selectedIndex = 0;
    needsInitialSelection = false;
  };

  const withoutDeleted = (sessions: any[] | null | undefined) =>
    (sessions ?? []).filter(
      (session: any) => session.path !== pending.deletedSessionPath,
    );
  const originalSetSessions = sessionList.setSessions;
  if (typeof originalSetSessions === "function") {
    sessionList.setSessions = function (
      this: any,
      sessions: any[],
      showCwd: boolean,
    ) {
      originalSetSessions.call(this, withoutDeleted(sessions), showCwd);
      selectPreferredOrFirst();
    };
  }

  selector.currentSessions = withoutDeleted(selector.currentSessions);
  if (selector.allSessions) {
    selector.allSessions = withoutDeleted(selector.allSessions);
  }
  sessionList.setSessions?.(
    pending.scope === "all"
      ? (selector.allSessions ?? [])
      : selector.currentSessions,
    pending.scope === "all",
  );

  selector.sortMode = pending.sortMode;
  selector.header?.setSortMode?.(pending.sortMode);
  sessionList.setSortMode?.(pending.sortMode);
  selector.nameFilter = pending.nameFilter;
  selector.header?.setNameFilter?.(pending.nameFilter);
  sessionList.setNameFilter?.(pending.nameFilter);
  sessionList.showPath = pending.showPath;
  selector.header?.setShowPath?.(pending.showPath);
  sessionList.searchInput?.setValue?.(pending.query);
  sessionList.filterSessions?.(pending.query);

  if (pending.scope === "all" && selector.scope !== "all") {
    selector.toggleScope?.();
  }
  selectPreferredOrFirst();
  selector.requestRender?.();
}

export function patchDeleteActiveSession(
  selector: any,
  interactiveMode: any,
  onSessionDeleted?: (sessionPath: string) => void,
) {
  const sessionList = getSessionList(selector);
  if (!sessionList) return;

  restorePickerState(selector, sessionList);
  const originalOnDeleteSession = sessionList.onDeleteSession;
  const deleteSession = async (receiver: any, sessionPath: string) => {
    try {
      await originalOnDeleteSession.call(receiver, sessionPath);
    } finally {
      if (!existsSync(sessionPath)) {
        try {
          onSessionDeleted?.(sessionPath);
        } catch {
          // The file deletion succeeded. A later reconciliation can repair a
          // catalog write failure without changing the successful UI action.
        }
      }
    }
  };

  sessionList.startDeleteConfirmationForSelectedSession = function (this: any) {
    const selected = this.filteredSessions[this.selectedIndex];
    if (!selected) return;
    this.setConfirmingDeletePath(selected.session.path);
  };

  const originalHandleInput = sessionList.handleInput;
  const header = selector.header;
  const originalSetStatusMessage = header?.setStatusMessage;
  if (
    typeof originalHandleInput === "function" &&
    typeof originalSetStatusMessage === "function"
  ) {
    let deletePending = false;

    header.setStatusMessage = function (
      this: any,
      message: any,
      autoHideMs?: number,
    ) {
      if (deletePending && message) {
        deletePending = false;
        this.setConfirmingDeletePath?.(null);
      }
      return originalSetStatusMessage.call(this, message, autoHideMs);
    };

    sessionList.handleInput = function (this: any, data: string) {
      if (deletePending) return;

      if (
        this.confirmingDeletePath !== null &&
        getKeybindings().matches(data, "tui.select.confirm")
      ) {
        const pathToDelete = this.confirmingDeletePath;
        deletePending = true;
        this.confirmingDeletePath = null;
        void this.onDeleteSession?.(pathToDelete);
        return;
      }

      return originalHandleInput.call(this, data);
    };
  }

  sessionList.onDeleteSession = async function (
    this: any,
    sessionPath: string,
  ) {
    if (!this.isCurrentSessionPath(sessionPath)) {
      await deleteSession(this, sessionPath);
      return;
    }

    const pickerState = capturePickerState(selector, this);
    const parentSession =
      interactiveMode.sessionManager?.getHeader?.()?.parentSession;
    let deleteAttempted = false;
    const deleteAfterSwitch = async () => {
      deleteAttempted = true;
      await deleteSession(this, sessionPath);
    };

    let result: any;
    if (typeof parentSession === "string" && existsSync(parentSession)) {
      result = await interactiveMode.handleResumeSession?.(parentSession, {
        withSession: deleteAfterSwitch,
      });
    } else if (interactiveMode.runtimeHost?.newSession) {
      try {
        result = await interactiveMode.runtimeHost.newSession({
          withSession: deleteAfterSwitch,
        });
      } catch (error) {
        await interactiveMode.handleFatalRuntimeError?.(
          "Failed to create session",
          error,
        );
        return;
      }
    } else {
      // Compatibility path for test doubles and older Pi runtimes that cannot
      // provide a post-switch callback.
      await deleteAfterSwitch();
      if (existsSync(sessionPath)) return;
      await interactiveMode.handleClearCommand?.();
      result = { cancelled: false };
    }

    if (result?.cancelled || !deleteAttempted) return;

    pickerState.preferredSessionPath =
      interactiveMode.sessionManager?.getSessionFile?.() ??
      (typeof parentSession === "string" ? parentSession : undefined);
    pickerState.deletedSessionPath = sessionPath;
    setPendingPickerState(pickerState);
    interactiveMode.showSessionSelector?.();
  };
}
