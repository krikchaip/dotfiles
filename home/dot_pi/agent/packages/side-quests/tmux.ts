import { spawn, spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";
import { sliceByColumn } from "@earendil-works/pi-tui";

/**
 * Captures the complete result of one tmux client process.
 */
type TmuxCommandResult = Readonly<{
  /** Contains the process exit status, or null when no status exists. */
  status: number | null;

  /** Contains standard output decoded as UTF-8 text. */
  stdout: string;

  /** Contains standard error decoded as UTF-8 text. */
  stderr: string;

  /** Contains a process start, timeout, or signal error. */
  error?: Error;
}>;

type WindowTitleMode = "managed" | "native" | "unclaimed";

/**
 * Reports whether Side Quests can update one window title.
 */
type WindowTitleControl =
  | Readonly<{ state: "side-quests"; mode: WindowTitleMode }>
  | Readonly<{ state: "user" }>
  | Readonly<{ state: "error"; error: string }>;

/**
 * Contains the selected pane or the tmux inspection error.
 */
type SelectedPaneResult =
  Readonly<{ paneId: string }> | Readonly<{ error: string }>;

/** Stores permanent title ownership on the tmux window. */
const TITLE_OWNER_OPTION = "@side_quests_title_owner";

/** Stores the last automatic rename format that Side Quests applied. */
const TITLE_FORMAT_OPTION = "@side_quests_title_format";

/** Distinguishes a managed literal from the inherited native format. */
const TITLE_MODE_OPTION = "@side_quests_title_mode";

/** Stages the next literal without putting it in a tmux command string. */
const TITLE_DESIRED_FORMAT_OPTION = "@side_quests_title_desired_format";

/** Captures the current effective format before ownership inspection. */
const TITLE_BASELINE_FORMAT_OPTION = "@side_quests_title_baseline_format";

/** Marks a stored format as one managed child description. */
const MANAGED_TITLE_MODE = "managed";

/** Marks a window that uses tmux's inherited automatic rename format. */
const NATIVE_TITLE_MODE = "native";

/** Marks a window whose title Side Quests can update. */
const SIDE_QUESTS_TITLE_OWNER = "side-quests";

/** Marks a window whose title only the tmux user can update. */
const USER_TITLE_OWNER = "user";

/** Bounds presentation work so it cannot retain the update slot forever. */
const TITLE_COMMAND_TIMEOUT_MS = 1_000;

/** Names and initializes the shared window before its first dynamic update. */
const INITIAL_WINDOW_TITLE = "Side Quests";

/**
 * Describes one tmux pane in the shared Side Quests window.
 */
export type Pane = Readonly<{
  /** Identifies the pane as a canonical tmux target. */
  id: string;

  /** Identifies the process that tmux started in the pane. */
  pid: number;

  /** Reports whether tmux recorded the pane process as exited. */
  dead: boolean;
}>;

/**
 * Describes the terminal state that tmux records for one pane process.
 */
export type PaneProcessState = Readonly<{
  /** Reports whether tmux recorded the pane process as exited. */
  dead: boolean;

  /** Records the numeric exit code when tmux provides one. */
  exitStatus?: number;

  /** Records the terminating signal when tmux provides one. */
  exitSignal?: string;
}>;

/**
 * Selects a binary or ternary child-window layout, while no value uses tiled.
 */
export enum WindowLayout {
  /** Selects the currently empty two-way layout strategy. */
  Binary = "binary",

  /** Selects the currently empty three-way layout strategy. */
  Ternary = "ternary",
}

/**
 * Provides the Side Quests boundary to the tmux command-line interface.
 */
export class Tmux {
  /**
   * Fails when Side Quests does not run inside a tmux pane.
   */
  public static requireTmux(): void {
    if (!process.env.TMUX || !process.env.TMUX_PANE)
      throw new Error("Side Quests requires an active tmux pane.");
  }

  /**
   * Reports whether the exact pane ID still exists.
   */
  public static paneExists(id: string): boolean {
    if (!id) return false;
    const result = Tmux.run(["display-message", "-p", "-t", id, "#{pane_id}"]);
    return result.status === 0 && Tmux.output(result.stdout).trim() === id;
  }

  /**
   * Returns the process state that tmux records for a pane.
   */
  public static paneProcessState(id: string): PaneProcessState | undefined {
    if (!id) return undefined;

    const result = Tmux.run([
      "display-message",
      "-p",
      "-t",
      id,
      "#{pane_id}\t#{pane_dead}\t#{pane_dead_status}\t#{pane_dead_signal}",
    ]);

    if (result.status !== 0) return undefined;

    const [paneId, rawDead, rawStatus, rawSignal] = Tmux.output(result.stdout)
      .trim()
      .split("\t");

    if (paneId !== id) return undefined;

    const status = rawStatus ? Number(rawStatus) : undefined;

    return {
      dead: rawDead === "1",
      ...(Number.isInteger(status) ? { exitStatus: status } : {}),
      ...(rawSignal ? { exitSignal: rawSignal } : {}),
    };
  }

  /**
   * Returns recorded process states for pane IDs with one tmux query.
   */
  public static paneProcessStates(
    paneIds: readonly string[],
  ): ReadonlyMap<string, PaneProcessState> {
    const requested = new Set(paneIds.filter(Boolean));
    if (!requested.size) return new Map();

    const result = Tmux.run([
      "list-panes",
      "-a",
      "-F",
      "#{pane_id}\t#{pane_dead}\t#{pane_dead_status}\t#{pane_dead_signal}",
    ]);

    if (result.status !== 0) return new Map();

    const states = new Map<string, PaneProcessState>();
    for (const line of Tmux.output(result.stdout).split("\n")) {
      const [paneId, rawDead, rawStatus, rawSignal] = line.split("\t");
      if (!paneId || !requested.has(paneId)) continue;

      const status = rawStatus ? Number(rawStatus) : undefined;
      states.set(paneId, {
        dead: rawDead === "1",
        ...(Number.isInteger(status) ? { exitStatus: status } : {}),
        ...(rawSignal ? { exitSignal: rawSignal } : {}),
      });
    }

    return states;
  }

  /**
   * Lists all panes in a window and their recorded process state.
   */
  public static runningPanes(windowId: string): Pane[] {
    const result = Tmux.run([
      "list-panes",
      "-t",
      windowId,
      "-F",
      "#{pane_id}\t#{pane_pid}\t#{pane_dead}",
    ]);

    if (result.status !== 0) return [];

    return Tmux.output(result.stdout)
      .split("\n")
      .flatMap((line) => {
        const [id, rawPid, rawDead] = line.split("\t");
        const pid = Number(rawPid);

        return id && Number.isInteger(pid)
          ? [{ id, pid, dead: rawDead === "1" }]
          : [];
      });
  }

  /**
   * Lists all panes in a window without blocking Pi's event loop.
   */
  public static async runningPanesAsync(windowId: string): Promise<Pane[]> {
    const result = await Tmux.runAsync([
      "list-panes",
      "-t",
      windowId,
      "-F",
      "#{pane_id}\t#{pane_pid}\t#{pane_dead}",
    ]);

    if (result.status !== 0) return [];

    return Tmux.output(result.stdout)
      .split("\n")
      .flatMap((line) => {
        const [id, rawPid, rawDead] = line.split("\t");
        const pid = Number(rawPid);

        return id && Number.isInteger(pid)
          ? [{ id, pid, dead: rawDead === "1" }]
          : [];
      });
  }

  /**
   * Creates the detached shared window and its first Pi child pane.
   */
  public static async createWindow(params: {
    cwd: string;
    command: string[];
    environment: Record<string, string>;
  }): Promise<{ windowId: string; paneId: string }> {
    const hookName = `after-new-window[${randomInt(1_000_000_000, 2_000_000_000)}]`;
    const initializeTitle = [
      `set-option -w automatic-rename-format "${INITIAL_WINDOW_TITLE}"`,
      "set-option -w automatic-rename on",
      `set-option -w ${TITLE_FORMAT_OPTION} "${INITIAL_WINDOW_TITLE}"`,
      `set-option -w ${TITLE_MODE_OPTION} ${MANAGED_TITLE_MODE}`,
      `set-option -w ${TITLE_OWNER_OPTION} ${SIDE_QUESTS_TITLE_OWNER}`,
      `set-hook -u ${hookName}`,
    ].join(" ; ");
    const result = await Tmux.runAsync([
      "set-hook",
      hookName,
      initializeTitle,
      ";",
      "new-window",
      "-d",
      "-P",
      "-F",
      "#{window_id}\t#{pane_id}",
      "-n",
      INITIAL_WINDOW_TITLE,
      "-c",
      params.cwd,
      ...Tmux.environmentArguments(params.environment),
      ...params.command,
      ";",
      "set-hook",
      "-u",
      hookName,
    ]);

    if (result.status !== 0) {
      await Tmux.removeWindowCreationHook(hookName);
      throw new Error(
        `Could not create Side Quests window: ${Tmux.error(result)}`,
      );
    }

    const [windowId, paneId] = Tmux.output(result.stdout).trim().split("\t");

    if (!windowId || !paneId) {
      await Tmux.removeWindowCreationHook(hookName);
      throw new Error("Could not identify Side Quests window.");
    }

    return { windowId, paneId };
  }

  /**
   * Removes a failed creation's one-shot hook without blocking indefinitely.
   */
  private static async removeWindowCreationHook(
    hookName: string,
  ): Promise<void> {
    await Tmux.runAsync(
      ["set-hook", "-u", hookName],
      undefined,
      undefined,
      TITLE_COMMAND_TIMEOUT_MS,
    );
  }

  /**
   * Makes tmux derive a window's visible title from one literal label.
   * Returns an error message instead of blocking child lifecycle work.
   */
  public static async setAutomaticWindowTitle(
    windowId: string,
    title: string,
  ): Promise<string | undefined> {
    const format = Tmux.literalWindowTitleFormat(
      Tmux.normalizeWindowTitle(title),
    );
    const staged = await Tmux.runTitleCommand([
      "set-option",
      "-Fw",
      "-t",
      windowId,
      TITLE_BASELINE_FORMAT_OPTION,
      "#{automatic-rename-format}",
      ";",
      "set-option",
      "-w",
      "-t",
      windowId,
      TITLE_DESIRED_FORMAT_OPTION,
      format,
    ]);
    if (staged.status !== 0) return Tmux.error(staged);

    const control = await Tmux.windowTitleControl(windowId);
    if (control.state === "error") return control.error;
    if (control.state === "user") return undefined;

    const result = await Tmux.runTitleCommand([
      "if-shell",
      "-F",
      "-t",
      windowId,
      Tmux.windowTitlePrecondition(control.mode),
      Tmux.managedTitleCommands(windowId),
      Tmux.userTitleCommands(windowId),
    ]);

    return result.status === 0 ? undefined : Tmux.error(result);
  }

  /**
   * Restores the inherited tmux automatic title for an unmanaged pane.
   * Returns an error message instead of blocking child lifecycle work.
   */
  public static async restoreAutomaticWindowTitle(
    windowId: string,
  ): Promise<string | undefined> {
    const control = await Tmux.windowTitleControl(windowId);
    if (control.state === "error") return control.error;
    if (control.state === "user" || control.mode === NATIVE_TITLE_MODE)
      return undefined;

    const result = await Tmux.runTitleCommand([
      "if-shell",
      "-F",
      "-t",
      windowId,
      Tmux.windowTitlePrecondition(control.mode),
      Tmux.nativeTitleCommands(windowId),
      Tmux.userTitleCommands(windowId),
    ]);

    return result.status === 0 ? undefined : Tmux.error(result);
  }

  /**
   * Returns the pane that tmux currently selects in one window.
   */
  public static async selectedPaneId(
    windowId: string,
  ): Promise<SelectedPaneResult> {
    const result = await Tmux.runAsync(
      ["display-message", "-p", "-t", windowId, "#{pane_id}"],
      undefined,
      undefined,
      TITLE_COMMAND_TIMEOUT_MS,
    );
    if (result.status !== 0) return { error: Tmux.error(result) };

    const paneId = Tmux.output(result.stdout).trim();
    return paneId
      ? { paneId }
      : { error: "tmux produced an empty selected pane ID." };
  }

  /**
   * Starts Pi directly in a new detached pane in the shared window.
   */
  public static async startPiPane(params: {
    windowId: string;
    cwd: string;
    command: string[];
    environment: Record<string, string>;
  }): Promise<string> {
    if (!existsSync(params.command[1] ?? ""))
      throw new Error(
        "Could not find the running Pi program for the child pane.",
      );

    const result = await Tmux.runAsync([
      "split-window",
      "-d",
      "-P",
      "-F",
      "#{pane_id}",
      "-t",
      params.windowId,
      "-c",
      params.cwd,
      ...Tmux.environmentArguments(params.environment),
      ...params.command,
    ]);

    if (result.status !== 0)
      throw new Error(
        `Could not start Side Quests child: ${Tmux.error(result)}`,
      );

    const id = Tmux.output(result.stdout).trim();
    if (!id) throw new Error("Could not identify Side Quests child pane.");

    return id;
  }

  /**
   * Marks a pane as owned by a child and retains failed process exits.
   */
  public static async markManagedPane(
    paneId: string,
    childId: string,
  ): Promise<void> {
    const result = await Tmux.runAsync([
      "set-option",
      "-p",
      "-t",
      paneId,
      "@side_quests_child_id",
      childId,
      ";",
      "set-option",
      "-p",
      "-t",
      paneId,
      "remain-on-exit",
      "failed",
    ]);

    if (result.status !== 0)
      throw new Error(
        `Could not mark Side Quests child pane: ${Tmux.error(result)}`,
      );
  }

  /**
   * Finds the live tmux pane that is marked with this child ID.
   */
  public static findManagedPane(
    childId: string,
  ): { paneId: string; windowId: string } | undefined {
    const result = Tmux.run([
      "list-panes",
      "-a",
      "-F",
      "#{pane_id}\t#{window_id}\t#{@side_quests_child_id}",
    ]);

    if (result.status !== 0) return undefined;

    for (const line of Tmux.output(result.stdout).split("\n")) {
      const [paneId, windowId, markedChildId] = line.split("\t");

      if (markedChildId === childId && paneId && windowId)
        return { paneId, windowId };
    }

    return undefined;
  }

  /**
   * Arranges all panes in a window with the requested layout strategy.
   */
  public static applyWindowLayout(
    windowId: string,
    layout?: WindowLayout,
  ): void {
    switch (layout) {
      case WindowLayout.Binary:
        Tmux.WindowLayoutStrategy.binary(windowId);
        break;
      case WindowLayout.Ternary:
        Tmux.WindowLayoutStrategy.ternary(windowId);
        break;
      default:
        Tmux.WindowLayoutStrategy.tiled(windowId);
    }
  }

  /**
   * Arranges all panes asynchronously for the launch path.
   */
  public static async applyWindowLayoutAsync(
    windowId: string,
    layout?: WindowLayout,
  ): Promise<void> {
    switch (layout) {
      case WindowLayout.Binary:
        await Tmux.WindowLayoutStrategy.binaryAsync(windowId);
        break;
      case WindowLayout.Ternary:
        await Tmux.WindowLayoutStrategy.ternaryAsync(windowId);
        break;
      default:
        await Tmux.WindowLayoutStrategy.tiledAsync(windowId);
    }
  }

  /**
   * Closes a managed pane, while tolerating a concurrent pane exit.
   */
  public static closePane(paneId: string): void {
    const result = Tmux.run(["kill-pane", "-t", paneId]);
    if (result.status !== 0 && Tmux.paneExists(paneId))
      throw new Error(
        `Could not close Side Quests pane: ${Tmux.error(result)}`,
      );
  }

  /**
   * Activates a pane by selecting its window and then the pane itself.
   */
  public static focusPane(paneId: string): void {
    const located = Tmux.run([
      "display-message",
      "-p",
      "-t",
      paneId,
      "#{window_id}",
    ]);

    const windowId = Tmux.output(located.stdout).trim();
    if (located.status !== 0 || !windowId)
      throw new Error(
        `Could not locate Side Quests pane: ${Tmux.error(located)}`,
      );

    const selectedWindow = Tmux.run(["select-window", "-t", windowId]);
    if (selectedWindow.status !== 0)
      throw new Error(
        `Could not select Side Quests window: ${Tmux.error(selectedWindow)}`,
      );

    const selectedPane = Tmux.run(["select-pane", "-t", paneId]);
    if (selectedPane.status !== 0)
      throw new Error(
        `Could not select Side Quests pane: ${Tmux.error(selectedPane)}`,
      );
  }

  /**
   * Runs tmux with the current process environment and optional overrides.
   */
  private static run(
    args: string[],
    cwd?: string,
    environment?: Record<string, string>,
  ): ReturnType<typeof spawnSync> {
    return spawnSync("tmux", args, {
      cwd,
      encoding: "utf8",
      env: { ...process.env, ...environment },
    });
  }

  /**
   * Runs tmux without blocking Pi's event loop.
   */
  private static runAsync(
    args: string[],
    cwd?: string,
    environment?: Record<string, string>,
    timeoutMs?: number,
  ): Promise<TmuxCommandResult> {
    return new Promise((resolve) => {
      const child = spawn("tmux", args, {
        cwd,
        env: { ...process.env, ...environment },
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timeout = timeoutMs
        ? setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill("SIGKILL");
            resolve({
              status: null,
              stdout,
              stderr,
              error: new Error(`tmux timed out after ${timeoutMs} ms`),
            });
          }, timeoutMs)
        : undefined;
      timeout?.unref();

      const finish = (result: TmuxCommandResult): void => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        resolve(result);
      };

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      child.once("error", (error) => {
        finish({ status: null, stdout, stderr, error });
      });
      child.once("close", (status) => {
        finish({ status, stdout, stderr });
      });
    });
  }

  /**
   * Converts environment values to tmux command-line arguments.
   */
  private static environmentArguments(
    environment: Record<string, string>,
  ): string[] {
    return Object.entries(environment).flatMap(([key, value]) => [
      "-e",
      `${key}=${value}`,
    ]);
  }

  /**
   * Runs one bounded tmux process for title presentation work.
   */
  private static runTitleCommand(args: string[]): Promise<TmuxCommandResult> {
    return Tmux.runAsync(args, undefined, undefined, TITLE_COMMAND_TIMEOUT_MS);
  }

  /**
   * Builds the server-side ownership precondition for one title change.
   */
  private static windowTitlePrecondition(mode: WindowTitleMode): string {
    if (mode === "unclaimed") return `#{==:#{${TITLE_OWNER_OPTION}},}`;

    const expectedOption =
      mode === NATIVE_TITLE_MODE
        ? TITLE_BASELINE_FORMAT_OPTION
        : TITLE_FORMAT_OPTION;
    return `#{&&:#{==:#{${TITLE_OWNER_OPTION}},${SIDE_QUESTS_TITLE_OWNER}},#{==:#{automatic-rename},1},#{==:#{automatic-rename-format},#{${expectedOption}}}}`;
  }

  /**
   * Builds the atomic command list for one managed literal title.
   */
  private static managedTitleCommands(windowId: string): string {
    return [
      `set-option -Fw -t ${windowId} automatic-rename-format "#{${TITLE_DESIRED_FORMAT_OPTION}}"`,
      `rename-window -t ${windowId} "#{E:automatic-rename-format}"`,
      `set-option -w -t ${windowId} automatic-rename on`,
      `set-option -Fw -t ${windowId} ${TITLE_FORMAT_OPTION} "#{${TITLE_DESIRED_FORMAT_OPTION}}"`,
      `set-option -w -t ${windowId} ${TITLE_MODE_OPTION} ${MANAGED_TITLE_MODE}`,
      `set-option -w -t ${windowId} ${TITLE_OWNER_OPTION} ${SIDE_QUESTS_TITLE_OWNER}`,
    ].join(" ; ");
  }

  /**
   * Builds the atomic command list for tmux's inherited native title.
   */
  private static nativeTitleCommands(windowId: string): string {
    return [
      `set-option -uw -t ${windowId} automatic-rename-format`,
      `rename-window -t ${windowId} "#{E:automatic-rename-format}"`,
      `set-option -w -t ${windowId} automatic-rename on`,
      `set-option -uw -t ${windowId} ${TITLE_FORMAT_OPTION}`,
      `set-option -w -t ${windowId} ${TITLE_MODE_OPTION} ${NATIVE_TITLE_MODE}`,
      `set-option -w -t ${windowId} ${TITLE_OWNER_OPTION} ${SIDE_QUESTS_TITLE_OWNER}`,
    ].join(" ; ");
  }

  /**
   * Builds the atomic fallback that transfers ownership to the user.
   */
  private static userTitleCommands(windowId: string): string {
    return `set-option -w -t ${windowId} ${TITLE_OWNER_OPTION} ${USER_TITLE_OWNER}`;
  }

  /**
   * Detects and persists transfer of title ownership to the tmux user.
   */
  private static async windowTitleControl(
    windowId: string,
  ): Promise<WindowTitleControl> {
    const inspected = await Tmux.runTitleCommand([
      "display-message",
      "-p",
      "-t",
      windowId,
      `#{automatic-rename}\t#{${TITLE_OWNER_OPTION}}\t#{${TITLE_FORMAT_OPTION}}\t#{${TITLE_MODE_OPTION}}`,
      ";",
      "show-options",
      "-wqv",
      "-t",
      windowId,
      "automatic-rename-format",
    ]);
    if (inspected.status !== 0)
      return { state: "error", error: Tmux.error(inspected) };

    const lines = Tmux.output(inspected.stdout).split("\n");
    const [automaticRename, owner, expectedFormat, mode] = (
      lines.shift() ?? ""
    ).split("\t");
    const localFormat = lines.join("\n").replace(/\n$/u, "");

    if (owner === USER_TITLE_OWNER) return { state: "user" };
    if (owner !== SIDE_QUESTS_TITLE_OWNER)
      return { state: "side-quests", mode: "unclaimed" };

    const resolvedMode: WindowTitleMode =
      mode === NATIVE_TITLE_MODE
        ? "native"
        : mode === MANAGED_TITLE_MODE || localFormat
          ? "managed"
          : "native";
    const expectedLocalFormat = resolvedMode === "native" ? "" : expectedFormat;
    if (automaticRename === "1" && localFormat === expectedLocalFormat)
      return { state: "side-quests", mode: resolvedMode };

    const transferred = await Tmux.runTitleCommand([
      "set-option",
      "-w",
      "-t",
      windowId,
      TITLE_OWNER_OPTION,
      USER_TITLE_OWNER,
    ]);

    return transferred.status === 0
      ? { state: "user" }
      : { state: "error", error: Tmux.error(transferred) };
  }

  /**
   * Encodes one title as literal tmux format text and avoids command tokens.
   */
  private static literalWindowTitleFormat(title: string): string {
    const escaped = title.replaceAll("#", "##");
    return escaped === ";" || escaped === "{" || escaped === "}"
      ? `${escaped}#{?0,,}`
      : escaped;
  }

  /**
   * Produces one safe literal title no wider than 48 terminal cells.
   */
  private static normalizeWindowTitle(title: string): string {
    const collapsed = stripVTControlCharacters(title)
      .replace(/\s+/gu, " ")
      .replace(/\p{Cc}/gu, "")
      .trim();

    return sliceByColumn(collapsed || "Side Quests", 0, 48, true);
  }

  /**
   * Returns text output from a tmux process result.
   */
  private static output(value: unknown): string {
    return typeof value === "string" ? value : "";
  }

  /**
   * Returns a usable error message for a failed tmux command.
   */
  private static error(
    result: ReturnType<typeof spawnSync> | TmuxCommandResult,
  ): string {
    return (
      result.error?.message ||
      Tmux.output(result.stderr).trim() ||
      `tmux exited ${String(result.status)}`
    );
  }

  private static readonly WindowLayoutStrategy = class WindowLayoutStrategy {
    /**
     * Applies the default tmux tiled layout to a window.
     */
    public static tiled(windowId: string): void {
      const result = Tmux.run(["select-layout", "-t", windowId, "tiled"]);
      if (result.status !== 0)
        throw new Error(
          `Could not arrange Side Quests panes: ${Tmux.error(result)}`,
        );
    }

    /**
     * Applies the default tmux tiled layout without blocking Pi's event loop.
     */
    public static async tiledAsync(windowId: string): Promise<void> {
      const result = await Tmux.runAsync([
        "select-layout",
        "-t",
        windowId,
        "tiled",
      ]);
      if (result.status !== 0)
        throw new Error(
          `Could not arrange Side Quests panes: ${Tmux.error(result)}`,
        );
    }

    /** Applies the binary Side Quests layout asynchronously. */
    public static async binaryAsync(_windowId: string): Promise<void> {}

    /** Applies the ternary Side Quests layout asynchronously. */
    public static async ternaryAsync(_windowId: string): Promise<void> {}

    /**
     * Applies the binary Side Quests layout to a window.
     */
    public static binary(_windowId: string): void {}

    /**
     * Applies the ternary Side Quests layout to a window.
     */
    public static ternary(_windowId: string): void {}
  };
}
