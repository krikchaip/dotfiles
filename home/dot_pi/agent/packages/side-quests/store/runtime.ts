import { join } from "node:path";

import { atomicJson } from "./session.ts";

/**
 * Records the active parent process that owns Side Quests coordination.
 */
export type OwnerState = Readonly<{
  /** Records the runtime-state schema version. */
  version: 1;

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
  version: 1;

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
 * Provides the Side Quests boundary to its private runtime state.
 */
export class RuntimeStore {
  /**
   * Writes the private owner record for a parent runtime instance.
   */
  public static writeOwner(state: Omit<OwnerState, "version">): void {
    atomicJson(RuntimeStore.ownerPath(state.parentId), {
      version: 1,
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
    atomicJson(RuntimeStore.childRuntimePath(state.parentId, state.childId), {
      version: 1,
      ...state,
      startedAt: state.startedAt ?? Date.now(),
    });
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
   * Returns the root directory for all private runtime state.
   */
  private static root(): string {
    const agentDir =
      process.env.PI_CODING_AGENT_DIR ?? `${process.env.HOME}/.pi/agent`;
    return join(agentDir, "side-quests", "runtime");
  }
}
