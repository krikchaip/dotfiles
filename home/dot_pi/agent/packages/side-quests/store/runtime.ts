import { join } from "node:path";

import { JsonStore, STORE_VERSION } from "./json.ts";
import type { Lifecycle } from "./session.ts";

/**
 * Records the active parent process that owns Side Quests coordination.
 */
export type OwnerState = Readonly<{
  /** Records the runtime-state schema version. */
  version: typeof STORE_VERSION;

  /** Identifies the parent Pi session. */
  parentId: string;

  /** Identifies this parent runtime instance. */
  ownerId: string;

  /** Identifies the process that owns this runtime instance. */
  pid: number;

  /** Records when the parent runtime instance started. */
  startedAt: number;

  /** Records when the parent runtime instance last renewed its lease. */
  leaseAt: number;

  /** Identifies the shared tmux window when one exists. */
  windowId?: string;
}>;

/**
 * Records the tmux pane assigned to an active child process.
 */
export type ChildRuntimeState = Readonly<{
  /** Records the runtime-state schema version. */
  version: typeof STORE_VERSION;

  /** Identifies the parent Pi session. */
  parentId: string;

  /** Identifies the child Pi session. */
  childId: string;

  /** Identifies the child's tmux pane. */
  paneId: string;

  /** Identifies the tmux window that contains the child's pane. */
  windowId: string;

  /** Records when Side Quests assigned the child pane. */
  startedAt: number;
}>;

/**
 * Records the current child process activity for parent polling.
 */
export type ActivitySnapshot = Readonly<{
  /** Records the runtime-state schema version. */
  version: typeof STORE_VERSION;

  /** Identifies the child Pi session. */
  childId: string;

  /** Orders snapshots from the same child process. */
  sequence: number;

  /** Records when the child produced this state change. */
  eventAt: number;

  /** Records when the child last confirmed it was alive. */
  heartbeatAt: number;

  /** Records the child's current agent-loop phase. */
  phase: "starting" | "active" | "waiting";

  /** Records the active Pi subsystem when one is known. */
  scope?: "agent" | "tool" | "provider";

  /** Records the active Pi tool name when one is known. */
  toolName?: string;

  /** Records the child's persistent completion mode. */
  lifecycle: Lifecycle;

  /** Reports whether the child has an unanswered parent question. */
  pendingRequest: boolean;
}>;

/**
 * Records a final outcome for the current child process run.
 */
export type TerminalState = Readonly<{
  /** Records the runtime-state schema version. */
  version: typeof STORE_VERSION;

  /** Identifies this terminal event for exactly-once delivery. */
  eventId: string;

  /** Identifies the child Pi session. */
  childId: string;

  /** Records the final child process outcome. */
  kind: "completed" | "failed" | "cancelled" | "closed";

  /** Records when the child process reached this outcome. */
  createdAt: number;

  /** Records the final child response when one is valid. */
  response?: string;

  /** Records the final child failure detail when one is available. */
  error?: string;
}>;

/**
 * Provides the Side Quests boundary to live parent and child process state.
 */
export class RuntimeStore {
  /**
   * Writes the private owner record for a parent runtime instance.
   */
  public static writeOwner(state: Omit<OwnerState, "version">): void {
    JsonStore.write(RuntimeStore.ownerPath(state.parentId), {
      version: STORE_VERSION,
      ...state,
    });
  }

  /**
   * Writes the private pane record for an active child process.
   */
  public static writeChildRuntime(
    state: Omit<ChildRuntimeState, "version" | "startedAt"> & {
      startedAt?: number;
    },
  ): void {
    JsonStore.write(
      RuntimeStore.childRuntimePath(state.parentId, state.childId),
      {
        version: STORE_VERSION,
        ...state,
        startedAt: state.startedAt ?? Date.now(),
      },
    );
  }

  /**
   * Writes the child activity snapshot that the parent polls.
   */
  public static writeActivity(
    parentId: string,
    state: Omit<ActivitySnapshot, "version">,
  ): void {
    JsonStore.write(RuntimeStore.activityPath(parentId, state.childId), {
      version: STORE_VERSION,
      ...state,
    });
  }

  /**
   * Reads and validates the current activity snapshot for a child.
   */
  public static readActivity(
    parentId: string,
    childId: string,
  ): ActivitySnapshot | undefined {
    const value = JsonStore.readRecord(
      RuntimeStore.activityPath(parentId, childId),
    );

    if (!value || value.version !== STORE_VERSION || value.childId !== childId)
      return undefined;

    if (
      !Number.isInteger(value.sequence) ||
      !Number.isFinite(value.heartbeatAt) ||
      !Number.isFinite(value.eventAt)
    )
      return undefined;

    if (!["starting", "active", "waiting"].includes(String(value.phase)))
      return undefined;

    if (
      !["autonomous", "interactive"].includes(String(value.lifecycle)) ||
      typeof value.pendingRequest !== "boolean"
    )
      return undefined;

    return value as unknown as ActivitySnapshot;
  }

  /**
   * Writes the final outcome for a current child process run.
   */
  public static writeTerminal(
    parentId: string,
    state: Omit<TerminalState, "version">,
  ): void {
    JsonStore.write(RuntimeStore.terminalPath(parentId, state.childId), {
      version: STORE_VERSION,
      ...state,
    });
  }

  /**
   * Reads and validates the terminal outcome for a child process run.
   */
  public static readTerminal(
    parentId: string,
    childId: string,
  ): TerminalState | undefined {
    const value = JsonStore.readRecord(
      RuntimeStore.terminalPath(parentId, childId),
    );

    if (!value || value.version !== STORE_VERSION || value.childId !== childId)
      return undefined;

    if (
      typeof value.eventId !== "string" ||
      !["completed", "failed", "cancelled", "closed"].includes(
        String(value.kind),
      ) ||
      !Number.isFinite(value.createdAt)
    )
      return undefined;

    if (value.response !== undefined && typeof value.response !== "string")
      return undefined;

    if (value.error !== undefined && typeof value.error !== "string")
      return undefined;

    return value as unknown as TerminalState;
  }

  /**
   * Reports whether a terminal record exists, including a malformed record.
   */
  public static hasTerminal(parentId: string, childId: string): boolean {
    return JsonStore.exists(RuntimeStore.terminalPath(parentId, childId));
  }

  /**
   * Removes a terminal record before a child process restarts.
   */
  public static clearTerminal(parentId: string, childId: string): void {
    JsonStore.remove(RuntimeStore.terminalPath(parentId, childId));
  }

  /**
   * Returns the private path for a parent's owner record.
   */
  private static ownerPath(parentId: string): string {
    return join(RuntimeStore.root(), parentId, "owner.json");
  }

  /**
   * Returns the private path for a child's pane record.
   */
  private static childRuntimePath(parentId: string, childId: string): string {
    return join(
      RuntimeStore.root(),
      parentId,
      "children",
      childId,
      "child.json",
    );
  }

  /**
   * Returns the private path for a child's activity snapshot.
   */
  private static activityPath(parentId: string, childId: string): string {
    return join(
      RuntimeStore.root(),
      parentId,
      "children",
      childId,
      "activity.json",
    );
  }

  /**
   * Returns the private path for a child's terminal outcome.
   */
  private static terminalPath(parentId: string, childId: string): string {
    return join(
      RuntimeStore.root(),
      parentId,
      "children",
      childId,
      "terminal.json",
    );
  }

  /**
   * Returns the root directory for all private runtime state.
   */
  private static root(): string {
    const agentDir =
      process.env.PI_CODING_AGENT_DIR ?? `${process.env.HOME}/.pi/agent`;
    return join(agentDir, "side-quests", "runtime");
  }
}
