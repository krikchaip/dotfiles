import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

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
   * Creates the detached shared window and its first Pi child pane.
   */
  public static createWindow(params: {
    name: string;
    cwd: string;
    command: string[];
    environment: Record<string, string>;
  }): { windowId: string; paneId: string } {
    const result = Tmux.run([
      "new-window",
      "-d",
      "-P",
      "-F",
      "#{window_id}\t#{pane_id}",
      "-n",
      params.name,
      "-c",
      params.cwd,
      ...Tmux.environmentArguments(params.environment),
      ...params.command,
    ]);

    if (result.status !== 0)
      throw new Error(
        `Could not create Side Quests window: ${Tmux.error(result)}`,
      );

    const [windowId, paneId] = Tmux.output(result.stdout).trim().split("\t");

    if (!windowId || !paneId)
      throw new Error("Could not identify Side Quests window.");

    return { windowId, paneId };
  }

  /**
   * Starts Pi directly in a new detached pane in the shared window.
   */
  public static startPiPane(params: {
    windowId: string;
    cwd: string;
    command: string[];
    environment: Record<string, string>;
  }): string {
    if (!existsSync(params.command[1] ?? ""))
      throw new Error(
        "Could not find the running Pi program for the child pane.",
      );

    const result = Tmux.run([
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
  public static markManagedPane(paneId: string, childId: string): void {
    const result = Tmux.run([
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
   * Returns text output from a tmux process result.
   */
  private static output(value: string | NonSharedBuffer | undefined): string {
    return typeof value === "string" ? value : "";
  }

  /**
   * Returns a usable error message for a failed tmux command.
   */
  private static error(result: ReturnType<typeof spawnSync>): string {
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
     * Applies the binary Side Quests layout to a window.
     */
    public static binary(_windowId: string): void {}

    /**
     * Applies the ternary Side Quests layout to a window.
     */
    public static ternary(_windowId: string): void {}
  };
}
