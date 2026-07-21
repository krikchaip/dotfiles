/**
 * Opens the selected /resume session in a tmux pane.
 *
 * Active sessions advertise their pane through a tmux pane option. Selecting a
 * session already active elsewhere requires a second press, then jumps to that
 * pane instead of launching a second writer for the same session file.
 */

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { rawKeyHint } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

const PANE_SESSION_OPTION = "@pi_resume_session";
const JUMP_CONFIRM_MS = 1_500;
const SPLIT_DOWN_KEY = "alt+s";
const SPLIT_RIGHT_KEY = "alt+v";

type SplitDirection = "down" | "right";

type PaneSession = {
  paneId: string;
  sessionId: string;
  windowId: string;
  pid: number;
  path: string;
};

type PendingJump = {
  key: string;
  path: string;
  expiresAt: number;
};

function canonicalSessionPath(path: string) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function tmuxPaneId() {
  return process.env.TMUX_PANE;
}

export function isTmuxResumeSplitAvailable() {
  return !!process.env.TMUX && !!tmuxPaneId();
}

function runTmux(args: string[]) {
  return spawnSync("tmux", args, {
    encoding: "utf8",
    env: process.env,
  });
}

function resultError(result: ReturnType<typeof runTmux>) {
  if (result.error) return result.error.message;
  const stderr = result.stderr?.trim();
  if (stderr) return stderr.split("\n")[0];
  return `tmux exited with code ${String(result.status)}`;
}

function paneSessionValue(path: string) {
  return JSON.stringify({
    pid: process.pid,
    path: canonicalSessionPath(path),
  });
}

export function advertiseTmuxSession(path: string | undefined) {
  const paneId = tmuxPaneId();
  if (!isTmuxResumeSplitAvailable() || !paneId) return;

  if (!path) {
    clearTmuxSessionAdvertisement();
    return;
  }

  runTmux([
    "set-option",
    "-p",
    "-t",
    paneId,
    PANE_SESSION_OPTION,
    paneSessionValue(path),
  ]);
}

export function clearTmuxSessionAdvertisement() {
  const paneId = tmuxPaneId();
  if (!isTmuxResumeSplitAvailable() || !paneId) return;

  const current = runTmux([
    "show-options",
    "-p",
    "-v",
    "-t",
    paneId,
    PANE_SESSION_OPTION,
  ]);
  if (current.status !== 0) return;

  try {
    const value = JSON.parse(current.stdout.trim());
    if (value?.pid !== process.pid) return;
  } catch {
    return;
  }

  runTmux(["set-option", "-p", "-u", "-t", paneId, PANE_SESSION_OPTION]);
}

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === "EPERM";
  }
}

function advertisedPanes() {
  const result = runTmux([
    "list-panes",
    "-a",
    "-F",
    `#{pane_id}\t#{session_id}\t#{window_id}\t#{${PANE_SESSION_OPTION}}`,
  ]);
  if (result.status !== 0) return [];

  const panes: PaneSession[] = [];
  for (const line of result.stdout.split("\n")) {
    if (!line) continue;
    const [paneId, sessionId, windowId, raw] = line.split("\t", 4);
    if (!paneId || !sessionId || !windowId || !raw) continue;

    try {
      const value = JSON.parse(raw);
      if (
        typeof value?.pid !== "number" ||
        typeof value?.path !== "string" ||
        !processIsAlive(value.pid)
      ) {
        continue;
      }
      panes.push({
        paneId,
        sessionId,
        windowId,
        pid: value.pid,
        path: canonicalSessionPath(value.path),
      });
    } catch {
      // Ignore stale or malformed pane metadata.
    }
  }
  return panes;
}

function paneRunningSession(path: string, panes: PaneSession[]) {
  const canonicalPath = canonicalSessionPath(path);
  const currentPane = tmuxPaneId();
  return panes.find(
    (pane) => pane.paneId !== currentPane && pane.path === canonicalPath,
  );
}

function focusPane(pane: PaneSession) {
  return runTmux([
    "switch-client",
    "-t",
    pane.sessionId,
    ";",
    "select-window",
    "-t",
    pane.windowId,
    ";",
    "select-pane",
    "-t",
    pane.paneId,
  ]);
}

function piCommand(sessionPath: string, sessionDir: string | undefined) {
  const args: string[] = [];
  if (sessionDir) args.push("--session-dir", sessionDir);
  args.push("--session", sessionPath);

  const piEntry = process.argv[1];
  return piEntry ? [process.execPath, piEntry, ...args] : ["pi", ...args];
}

function tmuxEnvironmentArgs() {
  const args: string[] = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key === "TMUX" || key === "TMUX_PANE") continue;
    args.push("-e", `${key}=${value}`);
  }
  return args;
}

function splitSession(
  session: any,
  interactiveMode: any,
  direction: SplitDirection,
) {
  const cwd = session.cwd || interactiveMode.sessionManager?.getCwd?.();
  if (!cwd) {
    return { ok: false, error: "Selected session has no working directory" };
  }

  const command = piCommand(
    session.path,
    interactiveMode.sessionManager?.getSessionDir?.(),
  );
  const result = runTmux([
    "split-window",
    direction === "right" ? "-h" : "-v",
    "-c",
    cwd,
    ...tmuxEnvironmentArgs(),
    ...command,
  ]);

  return result.status === 0
    ? { ok: true as const }
    : { ok: false as const, error: resultError(result) };
}

function selectedSession(selector: any) {
  const list =
    typeof selector.getSessionList === "function"
      ? selector.getSessionList()
      : selector.sessionList;
  return list?.filteredSessions?.[list.selectedIndex]?.session;
}

function showStatus(
  selector: any,
  interactiveMode: any,
  message: string,
  error = false,
) {
  selector.header?.setStatusMessage?.(
    { message, type: error ? "error" : "warning" },
    JUMP_CONFIRM_MS,
  );
  interactiveMode.ui?.requestRender?.();
}

function appendSplitHints(line: string, width: number) {
  const sep = " · ";
  const hints = `${rawKeyHint(SPLIT_DOWN_KEY, "sp")}${sep}${rawKeyHint(SPLIT_RIGHT_KEY, "vsp")}`;

  return truncateToWidth(`${line}${sep}${hints}`, width, "…");
}

export function patchTmuxSessionSplit(
  selector: any,
  interactiveMode: any,
  closePicker: () => void,
) {
  if (!isTmuxResumeSplitAvailable()) return;

  const originalHeaderRender = selector.header?.render;
  if (typeof originalHeaderRender === "function") {
    selector.header.render = function (this: any, width: number) {
      const lines = originalHeaderRender.call(this, width);
      if (
        this.confirmingDeletePath === null &&
        !this.statusMessage &&
        lines.length >= 3
      ) {
        // Native rendering has already truncated line 2 at `width`. Render it
        // once at a safe maximum to combine every group before truncating.
        const fullHintLine = originalHeaderRender.call(this, 10_000)[2] ?? "";
        lines[2] = appendSplitHints(fullHintLine, width);
      }
      return lines;
    };
  }

  const originalHandleInput = selector.handleInput;
  const openSessionPanes = advertisedPanes();
  let pendingJump: PendingJump | undefined;

  const clearPendingJump = () => {
    if (!pendingJump) return;
    pendingJump = undefined;
    selector.header?.setStatusMessage?.(null);
  };

  selector.handleInput = function (this: any, data: string) {
    const direction: SplitDirection | undefined = matchesKey(
      data,
      SPLIT_DOWN_KEY,
    )
      ? "down"
      : matchesKey(data, SPLIT_RIGHT_KEY)
        ? "right"
        : undefined;
    const isConfirm = matchesKey(data, "enter");

    if ((!direction && !isConfirm) || this.mode !== "list") {
      clearPendingJump();
      return originalHandleInput.call(this, data);
    }

    const session = selectedSession(this);
    if (!session?.path) return;

    const list =
      typeof this.getSessionList === "function"
        ? this.getSessionList()
        : this.sessionList;
    if (list?.isCurrentSessionPath?.(session.path)) {
      clearPendingJump();
      showStatus(this, interactiveMode, "Session already active in this pane");
      return;
    }

    const existingPane = paneRunningSession(session.path, openSessionPanes);
    const key = isConfirm
      ? "tui.select.confirm"
      : direction === "down"
        ? SPLIT_DOWN_KEY
        : SPLIT_RIGHT_KEY;
    const now = Date.now();

    if (existingPane) {
      if (
        pendingJump?.key === key &&
        pendingJump.path === canonicalSessionPath(session.path) &&
        pendingJump.expiresAt >= now
      ) {
        pendingJump = undefined;
        const result = focusPane(existingPane);
        if (result.status !== 0) {
          showStatus(
            this,
            interactiveMode,
            `tmux pane jump failed: ${resultError(result)}`,
            true,
          );
          return;
        }
        closePicker();
        return;
      }

      pendingJump = {
        key,
        path: canonicalSessionPath(session.path),
        expiresAt: now + JUMP_CONFIRM_MS,
      };
      showStatus(
        this,
        interactiveMode,
        "Session already open; press again to jump",
      );
      return;
    }

    clearPendingJump();
    if (isConfirm) return originalHandleInput.call(this, data);

    const result = splitSession(session, interactiveMode, direction!);
    if (!result.ok) {
      showStatus(
        this,
        interactiveMode,
        `tmux split failed: ${result.error}`,
        true,
      );
    }
  };
}
