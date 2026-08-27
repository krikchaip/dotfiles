import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  ExtensionAPI,
  ExtensionContext,
  MessageEndEvent,
} from "@earendil-works/pi-coding-agent";

import {
  WRAP_UP_MESSAGE_TYPE,
  type WrapUpEntryData,
} from "../renderer/wrap-up-renderer.ts";
import { type ActivitySnapshot, RuntimeStore } from "../store/runtime.ts";
import {
  type ChildManifest,
  type Lifecycle,
  SessionStore,
} from "../store/session.ts";

/** Identifies the hidden boundary before a new child's launch prompt. */
const LAUNCH_MESSAGE_TYPE = "side-quest-launch";

/** Explains the launch boundary without prescribing the handoff format. */
const LAUNCH_SCOPE_MARKER =
  "The next user message is the side quest launch prompt and starts its handoff scope. Earlier messages are inherited context only.";

/**
 * Describes the child state that the child UI renders.
 */
export type ChildStatus = Readonly<{
  /** Records the current durable child manifest. */
  manifest: ChildManifest;

  /** Records the current child completion mode. */
  lifecycle: Lifecycle;

  /** Reports whether the child has an unanswered parent question. */
  replyPending: boolean;
}>;

function environment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Side Quests child is missing ${name}.`);
  return value;
}

/**
 * Coordinates child lifecycle, persisted activity, and parent continuations.
 */
export class ChildRuntime {
  /**
   * Creates the child runtime and registers its lifecycle event handlers.
   */
  public static register(pi: ExtensionAPI): ChildRuntime {
    const runtime = new ChildRuntime(pi);
    runtime.installEventListeners();
    return runtime;
  }

  /** Identifies this runtime as the child role. */
  readonly role = "child" as const;

  /** Records listeners that install interactive-only child commands. */
  private interactiveListeners = new Set<() => void>();

  /** Records the last final assistant response from the current run. */
  private lastSettledResponse: string | undefined;

  /** Records the last terminal error from the current run. */
  private lastRunFailure: string | undefined;

  /** Reports whether the current run is a final wrap-up turn. */
  private wrappingUp = false;

  /** Records tools to restore if the final wrap-up turn does not complete. */
  private toolsBeforeWrapUp: string[] | undefined;

  /** Records final wrap-up responses hidden behind persisted banner entries. */
  private wrapUpResponses = new Set<string>();

  /** Records the heartbeat timer for activity and continuation polling. */
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  /** Records the child activity snapshot sequence. */
  private sequence = 0;

  /** Reports whether the Pi agent loop is currently active. */
  private active = false;

  /** Records whether the launch prompt still needs input-guard exclusion. */
  private initialInputPending: boolean;

  /** Records the persistent child completion mode. */
  private lifecycle: Lifecycle;

  /** Records the child identity supplied by the managed process environment. */
  private readonly childId = environment("PI_SIDE_QUESTS_CHILD_ID");

  /** Records the parent identity supplied by the managed process environment. */
  private readonly parentId = environment("PI_SIDE_QUESTS_PARENT_ID");

  /** Records the canonical managed child session path. */
  private readonly sessionPath = environment("PI_SIDE_QUESTS_SESSION");

  /** Records the launch prompt when this process starts a new child session. */
  private readonly initialPrompt =
    process.env.PI_SIDE_QUESTS_INITIAL_PROMPT?.trim();

  /** Records the validated manifest that created this child process. */
  private readonly manifest: ChildManifest;

  private constructor(private readonly pi: ExtensionAPI) {
    const manifest = SessionStore.readManifest(this.sessionPath);
    if (
      !manifest ||
      manifest.childId !== this.childId ||
      manifest.parentId !== this.parentId ||
      manifest.sessionPath !== this.sessionPath
    ) {
      throw new Error("Side Quests child manifest is invalid.");
    }

    this.manifest = manifest;
    this.lifecycle = manifest.lifecycle;
    this.initialInputPending = !!this.initialPrompt;
  }

  /**
   * Reports whether an agent or tool turn is currently active.
   */
  isActive(): boolean {
    return this.active;
  }

  /**
   * Reports whether the child has permanent interactive lifecycle state.
   */
  isInteractive(): boolean {
    return this.lifecycle === "interactive";
  }

  /**
   * Reports whether assistant Markdown belongs inside the final wrap-up banner.
   */
  shouldHideWrapUpResponse(markdown: string, _isStreaming: boolean): boolean {
    const normalized = markdown.trim();
    if (!normalized) return false;

    return this.wrappingUp || this.wrapUpResponses.has(normalized);
  }

  /**
   * Returns the current child state for child UI rendering.
   */
  status(): ChildStatus {
    return {
      manifest: this.currentManifest(),
      lifecycle: this.lifecycle,
      replyPending: !!SessionStore.readRequest(this.parentId, this.childId),
    };
  }

  /**
   * Registers a listener that runs now or when lifecycle becomes interactive.
   */
  onInteractive(listener: () => void): void {
    this.interactiveListeners.add(listener);
    if (this.isInteractive()) listener();
  }

  /**
   * Writes one correlated parent request and refreshes activity state.
   */
  askParent(prompt: string): void {
    if (SessionStore.hasRequest(this.parentId, this.childId))
      throw new Error(
        "A parent question is already pending for this subagent.",
      );

    SessionStore.writeRequest(this.parentId, {
      requestId: randomUUID(),
      childId: this.childId,
      prompt,
      createdAt: Date.now(),
    });

    this.snapshot(this.active ? "active" : "waiting");
  }

  /**
   * Completes an idle interactive child and shuts down its Pi process.
   */
  complete(context: { shutdown(): void }): void {
    this.finish("completed", context, this.lastSettledResponse);
  }

  /**
   * Starts one final tool-disabled synthesis turn before completion.
   */
  async wrapUp(): Promise<void> {
    if (this.active || this.wrappingUp)
      throw new Error("Wait for the current turn or interrupt it first.");

    this.wrappingUp = true;
    this.toolsBeforeWrapUp = this.pi.getActiveTools();
    this.pi.setActiveTools([]);

    try {
      await this.pi.sendMessage(
        {
          customType: WRAP_UP_MESSAGE_TYPE,
          content:
            "Prepare the final handoff to the parent agent. Find the most recent `side-quest-continuation` message in the conversation. If one exists, use that continuation and all work after it as the handoff scope; do not summarize earlier work. Otherwise, use the most recent `side-quest-launch` message and all work after it. Inherited messages before it are context only and outside the handoff scope. Choose the form that best serves that scope: answer a question directly, summarize the decision and trade-offs from a grilling session, or report an implementation result when applicable. Do not force a template, headings, or sections. Include only what the parent needs to continue or conclude the work. Do not continue implementation.",
          display: false,
        },
        { triggerTurn: true, deliverAs: "steer" },
      );
    } catch (cause) {
      this.restoreToolsAfterWrapUp();
      throw cause;
    }
  }

  /**
   * Registers all Pi event handlers owned by this child runtime.
   */
  private installEventListeners(): void {
    this.pi.on("session_start", (_event, context) => {
      this.startSession(context);
    });
    this.pi.on("input", (event, context) => this.handleInput(event, context));
    this.pi.on("agent_start", () => this.startAgent());
    this.pi.on("tool_execution_start", (event) => {
      this.snapshot("active", "tool", event.toolName);
    });
    this.pi.on("message_end", (event) => this.recordAssistantMessage(event));
    this.pi.on("agent_end", () => this.endAgent());
    this.pi.on("agent_settled", (_event, context) => {
      this.settleAgent(context);
    });
    this.pi.on("session_shutdown", (event, context) => {
      this.stopSession(event, context);
    });
  }

  /**
   * Validates child tools and starts runtime polling for one Pi session.
   */
  private startSession(context: ExtensionContext): void {
    const registered = new Set(this.pi.getAllTools().map((tool) => tool.name));
    const required = this.manifest.tools.filter((name) => name !== "Agent");

    const missing = required.filter((name) => !registered.has(name));
    if (missing.length) {
      context.ui.notify(
        `Side Quests cannot restore this subagent: missing tool ${missing.join(", ")}.`,
        "error",
      );
      context.shutdown();

      return;
    }

    this.pi.setActiveTools([...required, "ask_parent"]);

    if (this.initialPrompt) {
      this.pi.sendMessage(
        {
          customType: LAUNCH_MESSAGE_TYPE,
          content: LAUNCH_SCOPE_MARKER,
          display: false,
        },
        { triggerTurn: false, deliverAs: "steer" },
      );
    }

    this.snapshot("starting");
    this.startHeartbeat();
  }

  /**
   * Starts periodic activity snapshots and durable response delivery.
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    this.heartbeatTimer = setInterval(() => {
      void this.heartbeat();
    }, 1_000);
  }

  /**
   * Refreshes lifecycle state, attempts one response delivery, and records health.
   */
  private async heartbeat(): Promise<void> {
    const updated = this.currentManifest();
    if (updated.lifecycle === "interactive" && !this.isInteractive())
      this.promoteToInteractive();

    const response = SessionStore.readResponse(this.parentId, this.childId);
    const pendingRequest = SessionStore.readRequest(
      this.parentId,
      this.childId,
    );
    const matchingRequest =
      !!response?.requestId && response.requestId === pendingRequest?.requestId;

    if (
      response?.childId === this.childId &&
      (!response.requestId || matchingRequest)
    ) {
      try {
        await this.pi.sendMessage(
          {
            customType: "side-quest-continuation",
            content: response.prompt,
            display: true,
            details: {
              childId: this.childId,
              responseId: response.responseId,
              requestId: response.requestId,
              question: matchingRequest ? pendingRequest.prompt : undefined,
            },
          },
          { triggerTurn: true, deliverAs: "steer" },
        );

        SessionStore.clearResponse(this.parentId, this.childId);
        if (matchingRequest)
          SessionStore.clearRequest(this.parentId, this.childId);
      } catch {
        // Keep the response durable. The next heartbeat retries delivery.
      }
    }

    this.snapshot(this.active ? "active" : "waiting");
  }

  /**
   * Guards autonomous completion commands and promotes accepted direct input.
   */
  private handleInput(
    event: { source: string; text: string },
    context: ExtensionContext,
  ): { action: "continue" | "handled" } {
    const text = event.text.trim();
    const isInitialPrompt =
      this.initialInputPending && text === this.initialPrompt;
    this.initialInputPending = false;

    if (
      event.source === "interactive" &&
      !this.isInteractive() &&
      /^\/subagent-done(?:\s|$)/.test(text)
    ) {
      context.ui.notify(
        "/subagent-done is available only after interactive takeover.",
        "warning",
      );
      return { action: "handled" };
    }

    if (
      event.source === "interactive" &&
      !this.isInteractive() &&
      !isInitialPrompt &&
      text &&
      !text.startsWith("/")
    )
      this.promoteToInteractive();

    return { action: "continue" };
  }

  /**
   * Marks a direct terminal takeover as permanently interactive.
   */
  private promoteToInteractive(): void {
    if (this.isInteractive()) return;

    this.lifecycle = "interactive";

    const current = this.currentManifest();

    SessionStore.updateManifest(current, {
      description: current.description,
      lifecycle: this.lifecycle,
    });

    this.snapshot(this.active ? "active" : "waiting");

    for (const listener of this.interactiveListeners) listener();
  }

  /**
   * Starts a new agent run and resets its terminal-result state.
   */
  private startAgent(): void {
    this.active = true;
    this.lastSettledResponse = undefined;
    this.lastRunFailure = undefined;

    this.snapshot("active", "agent");
  }

  /**
   * Stores final assistant output or an agent-loop failure from the current run.
   */
  private recordAssistantMessage(
    event: Pick<MessageEndEvent, "message">,
  ): { message: AgentMessage } | undefined {
    const message = event.message;
    if (message.role !== "assistant") return;

    if (
      message.stopReason === "error" ||
      (this.wrappingUp && message.stopReason === "aborted")
    ) {
      this.lastRunFailure =
        message.errorMessage ||
        (message.stopReason === "aborted"
          ? "Wrap-up turn was interrupted."
          : "Child agent failed.");
      return;
    }

    this.lastSettledResponse =
      ChildRuntime.finalResponse([event.message]) ?? this.lastSettledResponse;

    if (!this.wrappingUp || !this.lastSettledResponse) return undefined;

    this.wrapUpResponses.add(this.lastSettledResponse.trim());

    return {
      message: { ...message, content: [] },
    };
  }

  /**
   * Marks a completed agent run as idle for interactive child lifecycle.
   */
  private endAgent(): void {
    this.active = false;
    if (this.isInteractive()) this.snapshot("waiting");
  }

  /**
   * Completes successful wrap-up turns and keeps failed ones open for recovery.
   */
  private settleAgent(context: {
    shutdown(): void;
    ui: { notify(message: string, level: "warning" | "error"): void };
  }): void {
    if (this.wrappingUp) {
      const response = this.lastSettledResponse?.trim();
      const failure = this.lastRunFailure;

      if (failure || !response) {
        this.restoreToolsAfterWrapUp();
        context.ui.notify(
          failure ?? "Wrap-up returned no text. The subagent remains open.",
          failure ? "error" : "warning",
        );
        return;
      }

      this.restoreToolsAfterWrapUp();
      this.pi.appendEntry<WrapUpEntryData>(WRAP_UP_MESSAGE_TYPE, {
        content: response,
      });
      this.finish("completed", context, response);
      return;
    }

    if (this.isInteractive()) return;

    context.shutdown();

    this.writeTerminal(
      this.lastRunFailure ? "failed" : "completed",
      this.lastSettledResponse,
      this.lastRunFailure,
    );
  }

  /** Restores the child tool set and clears final-wrap-up state. */
  private restoreToolsAfterWrapUp(): void {
    if (this.toolsBeforeWrapUp) this.pi.setActiveTools(this.toolsBeforeWrapUp);

    this.toolsBeforeWrapUp = undefined;
    this.wrappingUp = false;
  }

  /**
   * Stops polling and records unexpected autonomous process termination.
   */
  private stopSession(
    event: { reason: string },
    context: { shutdown(): void },
  ): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;

    if (
      event.reason !== "reload" &&
      !this.isInteractive() &&
      !RuntimeStore.hasTerminal(this.parentId, this.childId)
    )
      this.finish(
        "failed",
        context,
        undefined,
        "Child Pi process stopped before completion.",
      );
  }

  /**
   * Writes one child activity snapshot for parent polling.
   */
  private snapshot(
    phase: ActivitySnapshot["phase"],
    scope?: ActivitySnapshot["scope"],
    toolName?: string,
  ): void {
    this.sequence += 1;
    RuntimeStore.writeActivity(this.parentId, {
      childId: this.childId,
      sequence: this.sequence,
      eventAt: Date.now(),
      heartbeatAt: Date.now(),
      phase,
      scope,
      toolName,
      lifecycle: this.lifecycle,
      pendingRequest: !!SessionStore.readRequest(this.parentId, this.childId),
    } satisfies Omit<ActivitySnapshot, "version">);
  }

  /**
   * Writes one trusted terminal outcome for the current child process run.
   */
  private writeTerminal(
    kind: "completed" | "failed",
    response?: string,
    error?: string,
  ): void {
    RuntimeStore.writeTerminal(this.parentId, {
      eventId: randomUUID(),
      childId: this.childId,
      kind,
      createdAt: Date.now(),
      response,
      error,
    });
  }

  /**
   * Writes an outcome before Pi shuts down the child process.
   */
  private finish(
    kind: "completed" | "failed",
    context: { shutdown(): void },
    response?: string,
    error?: string,
  ): void {
    this.writeTerminal(kind, response, error);
    context.shutdown();
  }

  /**
   * Reads the latest valid manifest while retaining the launch manifest on error.
   */
  private currentManifest(): ChildManifest {
    return SessionStore.readManifest(this.sessionPath) ?? this.manifest;
  }

  /**
   * Returns the most recent non-empty assistant text in a message collection.
   */
  private static finalResponse(messages: unknown): string | undefined {
    if (!Array.isArray(messages)) return undefined;

    for (const item of [...messages].reverse()) {
      const message = item as { role?: unknown; content?: unknown };
      if (message.role !== "assistant" || !Array.isArray(message.content))
        continue;

      const text = message.content
        .filter(
          (part): part is { type: "text"; text: string } =>
            !!part &&
            typeof part === "object" &&
            (part as { type?: unknown }).type === "text" &&
            typeof (part as { text?: unknown }).text === "string",
        )
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (text) return text;
    }

    return undefined;
  }
}
