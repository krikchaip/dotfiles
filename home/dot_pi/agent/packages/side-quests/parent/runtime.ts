import { randomUUID } from "node:crypto";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { CHILD_ID_ENV } from "../role.ts";
import { RuntimeStore, type TerminalState } from "../store/runtime.ts";
import { type ChildManifest, SessionStore } from "../store/session.ts";
import { Tmux } from "../tmux.ts";
import { RESULT_MESSAGE_TYPE } from "./ui.ts";

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

/**
 * Coordinates parent-owned child processes and their persisted runtime state.
 */
export class ParentRuntime {
  /** Identifies this runtime as the parent role. */
  readonly role = "parent" as const;

  /** Identifies this parent process in managed child manifests and runtime state. */
  readonly ownerId = randomUUID();

  /** Records managed children by child ID. */
  private childrenById = new Map<string, ParentChild>();

  /** Records parent events that Pi already received. */
  private deliveredEvents = new Set<string>();

  /** Records children whose panes were missing during the previous poll. */
  private missingPanes = new Set<string>();

  /** Identifies the shared tmux window when one exists. */
  private windowId: string | undefined;

  /** Records the timer that polls managed children. */
  private poller: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly pi: ExtensionAPI) {}

  /**
   * Registers all Pi session event handlers for this runtime.
   */
  installEventListeners(): void {
    this.pi.on("session_start", (_event, context) => {
      if (this.poller) clearInterval(this.poller);

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
   * Delivers a child event once as a parent follow-up message.
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
      { triggerTurn: true, deliverAs: "followUp" },
    );
  }

  /**
   * Polls managed children for parent requests and terminal outcomes.
   */
  private poll(): void {
    for (const child of this.childrenById.values()) {
      const request = SessionStore.readRequest(
        child.manifest.parentId,
        child.manifest.childId,
      );

      if (request) {
        this.deliver(
          request.requestId,
          `Subagent asks: ${request.prompt}\nResume: ${child.manifest.sessionPath}`,
          {
            kind: "parent-request",
            childId: child.manifest.childId,
            sessionPath: child.manifest.sessionPath,
            response: request.prompt,
          },
        );
      }

      let terminal: Omit<TerminalState, "version"> | undefined =
        RuntimeStore.readTerminal(
          child.manifest.parentId,
          child.manifest.childId,
        );

      const processState = Tmux.paneProcessState(child.paneId);

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

      if (Tmux.paneExists(child.paneId)) continue;

      const text = [
        `Subagent ${terminal.kind}: ${child.manifest.displayName} — ${child.manifest.description}`,
        terminal.response ? `Result: ${terminal.response}` : undefined,
        terminal.error ? `Error: ${terminal.error}` : undefined,
        request && terminal.kind === "closed"
          ? "A parent question remains unanswered and saved."
          : undefined,
        `Resume: ${child.manifest.sessionPath}`,
      ]
        .filter(Boolean)
        .join("\n");

      this.deliver(terminal.eventId, text, {
        kind: terminal.kind,
        childId: child.manifest.childId,
        sessionPath: child.manifest.sessionPath,
        response: terminal.response,
        error: terminal.error,
        pendingRequest: !!request,
      });

      this.childrenById.delete(child.manifest.childId);
    }
  }
}
