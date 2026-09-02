import { randomUUID } from "node:crypto";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { RESULT_MESSAGE_TYPE } from "../renderer/side-quest-result-renderer.ts";
import { CHILD_ID_ENV, PARENT_PANE_ENV } from "../role.ts";
import {
  type ActivitySnapshot,
  RuntimeStore,
  type TerminalState,
} from "../store/runtime.ts";
import { type ChildManifest, SessionStore } from "../store/session.ts";
import { Tmux } from "../tmux.ts";

/**
 * Describes a managed child and its tmux location.
 */
export type ParentChild = Readonly<{
  /** Records the durable child identity and launch configuration. */
  manifest: ChildManifest;

  /** Identifies the tmux pane that hosts the child process. */
  paneId: string;

  /** Identifies the tmux window that contains the child pane. */
  windowId: string;
}>;

/** Describes the semantic intent and process effect of one continuation. */
export type ParentContinuation = Readonly<{
  /** Distinguishes an answer to ask_parent from a direct parent instruction. */
  continuationKind: "answer" | "steer";

  /** Records whether the existing child continued or had to reopen. */
  operation: "continued" | "reopened";
}>;

/**
 * Coordinates parent-owned child processes and their persisted runtime state.
 */
export class ParentRuntime {
  /**
   * Creates the parent runtime and registers its lifecycle handlers.
   */
  public static register(pi: ExtensionAPI): ParentRuntime {
    const runtime = new ParentRuntime(pi);
    runtime.installEventListeners();
    return runtime;
  }

  /** Identifies this runtime as the parent role. */
  readonly role = "parent" as const;

  /** Identifies this parent process in managed child manifests and runtime state. */
  readonly ownerId = randomUUID();

  /** Records managed children by child ID. */
  private childrenById = new Map<string, ParentChild>();

  /** Caches child activity so widget repaint does not read files. */
  private activityByChildId = new Map<string, ActivitySnapshot | undefined>();

  /** Caches unanswered-request state so widget repaint does not read files. */
  private replyPendingByChildId = new Map<string, boolean>();

  /** Records parent events that Pi already received. */
  private deliveredEvents = new Set<string>();

  /** Records children whose panes were missing during the previous poll. */
  private missingPanes = new Set<string>();

  /** Identifies the shared tmux window when one exists. */
  private windowId: string | undefined;

  /** Records the timer that polls managed children. */
  private poller: ReturnType<typeof setInterval> | undefined;

  /** Serializes tmux mutations for the one shared child window. */
  private launchTail: Promise<void> = Promise.resolve();

  /** Holds the one active best-effort title update. */
  private titleSyncActive: Promise<void> | undefined;

  /** Requests one coalesced update after the active title update. */
  private titleSyncRequested = false;

  /** Reports the first title failure through the current Pi session UI. */
  private notifyTitleFailure: ((message: string) => void) | undefined;

  /** Prevents repeated title warnings while retries continue. */
  private titleFailureWarned = false;

  private constructor(private readonly pi: ExtensionAPI) {}

  /**
   * Reserves launch order, then starts and retains a child when storage is ready.
   */
  async launch(
    manifest: ChildManifest | Promise<ChildManifest>,
    initialPrompt?: string,
  ): Promise<ChildManifest> {
    const operation = this.launchTail.then(async () =>
      this.open(await manifest, initialPrompt),
    );
    this.launchTail = operation.then(
      () => undefined,
      () => undefined,
    );

    const child = await operation;
    this.childrenById.set(child.manifest.childId, child);
    this.activityByChildId.set(
      child.manifest.childId,
      RuntimeStore.readActivity(
        child.manifest.parentId,
        child.manifest.childId,
      ),
    );
    this.replyPendingByChildId.set(
      child.manifest.childId,
      !!SessionStore.readRequest(
        child.manifest.parentId,
        child.manifest.childId,
      ),
    );

    void this.syncWindowTitle();

    return child.manifest;
  }

  /**
   * Sends a prompt to a managed child and reopens its process when it stopped.
   */
  async continue(
    manifest: ChildManifest,
    prompt: string,
  ): Promise<ParentContinuation> {
    const previous = this.childrenById.get(manifest.childId);
    const located = previous
      ? undefined
      : Tmux.findManagedPane(manifest.childId);

    if (located) this.windowId = located.windowId;

    const child: ParentChild = previous
      ? { ...previous, manifest }
      : located
        ? {
            manifest,
            paneId: located.paneId,
            windowId: located.windowId,
          }
        : { manifest, paneId: "", windowId: this.windowId ?? "" };

    this.childrenById.set(manifest.childId, child);

    const request = SessionStore.readRequest(
      manifest.parentId,
      manifest.childId,
    );
    this.activityByChildId.set(
      manifest.childId,
      RuntimeStore.readActivity(manifest.parentId, manifest.childId),
    );
    this.replyPendingByChildId.set(manifest.childId, !!request);
    const continuationKind = request ? "answer" : "steer";

    SessionStore.writeResponse(manifest.parentId, {
      responseId: randomUUID(),
      requestId: request?.requestId,
      childId: manifest.childId,
      prompt,
      createdAt: Date.now(),
    });

    void this.syncWindowTitle();

    const stopped = !!RuntimeStore.readTerminal(
      manifest.parentId,
      manifest.childId,
    );

    if (!stopped && Tmux.paneExists(child.paneId))
      return { continuationKind, operation: "continued" };

    if (stopped && Tmux.paneExists(child.paneId)) {
      const deadline = Date.now() + 10_000;

      while (Tmux.paneExists(child.paneId) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 100));

      if (Tmux.paneExists(child.paneId))
        throw new Error("The stopped Side Quests child pane did not exit.");

      // tmux removes the pane before the child process has fully released its
      // session resources. Do not race the replacement Pi process against it.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    RuntimeStore.clearTerminal(manifest.parentId, manifest.childId);

    await this.launch(manifest);

    return { continuationKind, operation: "reopened" };
  }

  /**
   * Lists children retained by the one-second liveness poll.
   */
  children(): readonly ParentChild[] {
    return [...this.childrenById.values()];
  }

  /**
   * Stops a child, reports its cancellation, and updates its window layout.
   */
  close(childId: string): void {
    const child = this.childrenById.get(childId);
    if (!child) return;

    const terminal = {
      eventId: randomUUID(),
      childId: child.manifest.childId,
      kind: "cancelled" as const,
      createdAt: Date.now(),
    };

    RuntimeStore.writeTerminal(child.manifest.parentId, terminal);

    const request = SessionStore.readRequest(
      child.manifest.parentId,
      child.manifest.childId,
    );
    const text = [
      `Subagent cancelled: ${child.manifest.displayName} — ${child.manifest.description}`,
      request ? "A parent question remains unanswered and saved." : undefined,
      `Resume: ${child.manifest.sessionPath}`,
    ]
      .filter(Boolean)
      .join("\n");

    this.deliver(terminal.eventId, text, {
      kind: terminal.kind,
      childId,
      subagentType: child.manifest.agentName,
      description: child.manifest.description,
      question: request?.prompt,
      sessionPath: child.manifest.sessionPath,
      pendingRequest: !!request,
    });

    Tmux.closePane(child.paneId);

    if (child.windowId && Tmux.runningPanes(child.windowId).length)
      Tmux.applyWindowLayout(child.windowId);

    this.childrenById.delete(childId);
    this.activityByChildId.delete(childId);
    this.replyPendingByChildId.delete(childId);
    this.missingPanes.delete(childId);
    void this.syncWindowTitle();
  }

  /**
   * Focuses a child's live tmux pane.
   */
  focus(childId: string): void {
    const child = this.childrenById.get(childId);
    if (!child || !Tmux.paneExists(child.paneId)) return;

    Tmux.focusPane(child.paneId);
    void this.syncWindowTitle();
  }

  /**
   * Gets the current activity state for a child.
   */
  status(child: ParentChild): "starting" | "active" | "waiting" | "stalled" {
    const snapshot = this.childrenById.has(child.manifest.childId)
      ? this.activityByChildId.get(child.manifest.childId)
      : RuntimeStore.readActivity(
          child.manifest.parentId,
          child.manifest.childId,
        );

    if (!snapshot) return "starting";
    if (Date.now() - snapshot.heartbeatAt >= 60_000) return "stalled";

    return snapshot.phase;
  }

  /**
   * Reports whether a child has an unanswered parent request.
   */
  replyPending(child: ParentChild): boolean {
    return this.childrenById.has(child.manifest.childId)
      ? (this.replyPendingByChildId.get(child.manifest.childId) ?? false)
      : !!SessionStore.readRequest(
          child.manifest.parentId,
          child.manifest.childId,
        );
  }

  /**
   * Registers all Pi session event handlers for this runtime.
   */
  private installEventListeners(): void {
    this.pi.on("session_start", (_event, context) => {
      if (this.poller) clearInterval(this.poller);

      this.notifyTitleFailure = (message) =>
        context.ui.notify(message, "warning");
      this.writeOwner(context);

      this.poller = setInterval(() => {
        this.writeOwner(context);
        this.poll();
      }, 1_000);
    });

    this.pi.on("session_shutdown", (event) => {
      if (this.poller) clearInterval(this.poller);
      this.poller = undefined;

      if (event.reason === "reload") return;

      for (const child of this.childrenById.values())
        Tmux.closePane(child.paneId);

      this.childrenById.clear();
      this.activityByChildId.clear();
      this.replyPendingByChildId.clear();
      this.missingPanes.clear();
    });
  }

  /**
   * Writes the current parent process lease to runtime storage.
   */
  private writeOwner(context: ExtensionContext): void {
    RuntimeStore.writeOwner({
      parentId: context.sessionManager.getSessionId(),
      ownerId: this.ownerId,
      pid: process.pid,
      startedAt: Date.now(),
      leaseAt: Date.now(),
      windowId: this.windowId,
    });
  }

  /**
   * Delivers a child event once at the parent's next model-call boundary.
   */
  private deliver(
    eventId: string,
    text: string,
    details: Record<string, unknown>,
  ): void {
    if (this.deliveredEvents.has(eventId)) return;
    this.deliveredEvents.add(eventId);

    this.pi.sendMessage(
      {
        customType: RESULT_MESSAGE_TYPE,
        content: text,
        display: true,
        details,
      },
      { triggerTurn: true, deliverAs: "steer" },
    );
  }

  /**
   * Polls managed children for parent requests and terminal outcomes.
   */
  private poll(): void {
    void this.syncWindowTitle();

    const processStates = Tmux.paneProcessStates(
      [...this.childrenById.values()].map((child) => child.paneId),
    );

    for (const child of this.childrenById.values()) {
      const request = SessionStore.readRequest(
        child.manifest.parentId,
        child.manifest.childId,
      );
      this.activityByChildId.set(
        child.manifest.childId,
        RuntimeStore.readActivity(
          child.manifest.parentId,
          child.manifest.childId,
        ),
      );
      this.replyPendingByChildId.set(child.manifest.childId, !!request);

      if (request) {
        this.deliver(
          request.requestId,
          `Subagent asks: ${request.prompt}\nResume: ${child.manifest.sessionPath}`,
          {
            kind: "parent-request",
            childId: child.manifest.childId,
            subagentType: child.manifest.agentName,
            description: child.manifest.description,
            question: request.prompt,
            sessionPath: child.manifest.sessionPath,
          },
        );
      }

      let terminal: Omit<TerminalState, "version"> | undefined =
        RuntimeStore.readTerminal(
          child.manifest.parentId,
          child.manifest.childId,
        );

      const processState = processStates.get(child.paneId);

      // A live pane clears a prior transient absence and has no outcome yet.
      if (!terminal && processState && !processState.dead) {
        this.missingPanes.delete(child.manifest.childId);
        continue;
      }

      // A missing pane or dead process gets one full poll interval so a racing
      // trusted terminal sidecar can win.
      if (!terminal && !this.missingPanes.has(child.manifest.childId)) {
        this.missingPanes.add(child.manifest.childId);
        continue;
      }

      // No trusted outcome arrived during the grace interval, so record tmux's
      // observed process outcome as the terminal state.
      if (!terminal) {
        const failed =
          !!processState?.dead &&
          ((processState.exitStatus !== undefined &&
            processState.exitStatus !== 0) ||
            !!processState.exitSignal);

        const failureDetail =
          processState?.exitStatus !== undefined
            ? `status ${processState.exitStatus}`
            : processState?.exitSignal
              ? `signal ${processState.exitSignal}`
              : undefined;

        terminal = {
          eventId: randomUUID(),
          childId: child.manifest.childId,
          kind: failed ? "failed" : "closed",
          createdAt: Date.now(),
          error:
            failed && failureDetail
              ? `Child process exited with ${failureDetail}.`
              : "Child tmux pane closed before reporting an outcome.",
        };

        RuntimeStore.writeTerminal(child.manifest.parentId, terminal);
      }

      if (processState?.dead) Tmux.closePane(child.paneId);

      if (processState && !processState.dead) continue;

      const text = [
        `Subagent ${terminal.kind}: ${child.manifest.displayName} — ${child.manifest.description}`,
        terminal.response ? `Result: ${terminal.response}` : undefined,
        terminal.error ? `Error: ${terminal.error}` : undefined,
        request ? "A parent question remains unanswered and saved." : undefined,
        `Resume: ${child.manifest.sessionPath}`,
      ]
        .filter(Boolean)
        .join("\n");

      this.deliver(terminal.eventId, text, {
        kind: terminal.kind,
        childId: child.manifest.childId,
        subagentType: child.manifest.agentName,
        description: child.manifest.description,
        question: request?.prompt,
        sessionPath: child.manifest.sessionPath,
        response: terminal.response,
        error: terminal.error,
        pendingRequest: !!request,
      });

      this.childrenById.delete(child.manifest.childId);
      this.activityByChildId.delete(child.manifest.childId);
      this.replyPendingByChildId.delete(child.manifest.childId);
      this.missingPanes.delete(child.manifest.childId);
    }
  }

  /**
   * Starts or coalesces one best-effort title update.
   */
  private syncWindowTitle(): Promise<void> {
    this.titleSyncRequested = true;
    if (this.titleSyncActive) return this.titleSyncActive;

    const operation = this.drainWindowTitleUpdates().finally(() => {
      this.titleSyncActive = undefined;
      if (this.titleSyncRequested) void this.syncWindowTitle();
    });
    this.titleSyncActive = operation;
    return operation;
  }

  /**
   * Runs at most one follow-up after requests received during active work.
   */
  private async drainWindowTitleUpdates(): Promise<void> {
    while (this.titleSyncRequested) {
      this.titleSyncRequested = false;
      await this.updateWindowTitle();
    }
  }

  /**
   * Makes the visible window title follow tmux's selected pane.
   */
  private async updateWindowTitle(): Promise<void> {
    try {
      const windowId = this.windowId;
      if (!windowId) return;

      const selection = await Tmux.selectedPaneId(windowId);
      if ("missing" in selection) {
        if (this.windowId === windowId) this.windowId = undefined;
        return;
      }
      if ("error" in selection) {
        this.warnTitleFailure(selection.error);
        return;
      }

      const selectedChild = [...this.childrenById.values()].find(
        (child) => child.paneId === selection.paneId,
      );
      const error = selectedChild
        ? await Tmux.setAutomaticWindowTitle(
            windowId,
            selectedChild.manifest.description,
          )
        : await Tmux.restoreAutomaticWindowTitle(windowId);

      if (error) this.warnTitleFailure(error);
    } catch (cause) {
      this.warnTitleFailure(
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }

  /**
   * Shows only the first title failure while later polls keep retrying.
   */
  private warnTitleFailure(error: string): void {
    if (this.titleFailureWarned || !this.notifyTitleFailure) return;

    this.titleFailureWarned = true;
    this.notifyTitleFailure(
      `Side Quests could not update the tmux window title: ${error}`,
    );
  }

  /**
   * Starts one child process in the shared managed tmux window.
   */
  private async open(
    manifest: ChildManifest,
    initialPrompt?: string,
  ): Promise<ParentChild> {
    const environment = {
      [CHILD_ID_ENV]: manifest.childId,
      [PARENT_PANE_ENV]: process.env.TMUX_PANE ?? "",
      PI_SIDE_QUESTS_PARENT_ID: manifest.parentId,
      PI_SIDE_QUESTS_OWNER_ID: manifest.ownerId,
      PI_SIDE_QUESTS_SESSION: manifest.sessionPath,
      ...(initialPrompt
        ? { PI_SIDE_QUESTS_INITIAL_PROMPT: initialPrompt }
        : {}),
      ...(process.env.PI_CODING_AGENT_DIR
        ? { PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR }
        : {}),
    };

    const command = this.childCommand(manifest, initialPrompt);

    if (
      this.windowId &&
      (await Tmux.runningPanesAsync(this.windowId)).length === 0
    )
      this.windowId = undefined;

    if (!this.windowId) {
      const created = await Tmux.createWindow({
        cwd: manifest.cwd,
        command,
        environment,
        parentPaneId: environment[PARENT_PANE_ENV],
      });

      this.windowId = created.windowId;

      try {
        await Tmux.markManagedPane(created.paneId, manifest.childId);
        RuntimeStore.writeChildRuntime({
          parentId: manifest.parentId,
          childId: manifest.childId,
          paneId: created.paneId,
          windowId: this.windowId,
        });

        return {
          manifest,
          paneId: created.paneId,
          windowId: this.windowId,
        };
      } catch (cause) {
        Tmux.closePane(created.paneId);
        throw cause;
      }
    }

    const paneId = await Tmux.startPiPane({
      windowId: this.windowId,
      cwd: manifest.cwd,
      command,
      environment,
    });

    try {
      await Tmux.markManagedPane(paneId, manifest.childId);
      await Tmux.applyWindowLayoutAsync(this.windowId);

      RuntimeStore.writeChildRuntime({
        parentId: manifest.parentId,
        childId: manifest.childId,
        paneId,
        windowId: this.windowId,
      });

      return { manifest, paneId, windowId: this.windowId };
    } catch (cause) {
      Tmux.closePane(paneId);
      throw cause;
    }
  }

  /**
   * Builds the Pi command that starts a managed child process.
   */
  private childCommand(
    manifest: ChildManifest,
    initialPrompt?: string,
  ): string[] {
    const entry = process.argv[1];
    if (!entry) throw new Error("Could not identify the Pi executable.");

    const command = [
      process.execPath,
      entry,
      "--session",
      manifest.sessionPath,
      "--extension",
      new URL("../child/index.ts", import.meta.url).pathname,
    ];

    if (manifest.model) command.push("--model", manifest.model);
    if (manifest.thinking) command.push("--thinking", manifest.thinking);

    // The CLI list is an execution allowlist, not only the initial active set.
    // Interactive startup hides subagent_done until its human command needs it.
    command.push(
      "--tools",
      [...manifest.tools, "ask_parent", "subagent_done"].join(","),
    );

    if (initialPrompt) command.push(initialPrompt);

    return command;
  }
}
