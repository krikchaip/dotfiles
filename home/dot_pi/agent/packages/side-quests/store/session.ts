import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { JsonStore, STORE_VERSION } from "./json.ts";

/** Selects whether a child can finish automatically or needs a user command. */
export type Lifecycle = "autonomous" | "interactive";

/**
 * Records the resumable identity and immutable launch policy for one child.
 */
export type ChildManifest = Readonly<{
  /** Records the session-store schema version. */
  version: typeof STORE_VERSION;

  /** Identifies the child Pi session. */
  childId: string;

  /** Identifies the parent Pi session. */
  parentId: string;

  /** Identifies the parent runtime instance that launched the child. */
  ownerId: string;

  /** Records the canonical path to the child Pi session file. */
  sessionPath: string;

  /** Records the child's working directory. */
  cwd: string;

  /** Identifies the resolved child agent definition. */
  agentName: "general-purpose";

  /** Records the child name shown in the parent UI. */
  displayName: string;

  /** Records the assigned child objective. */
  description: string;

  /** Records the child's persistent completion mode. */
  lifecycle: Lifecycle;

  /** Records whether the child copied the parent conversation at creation. */
  inheritContext: boolean;

  /** Records the selected Pi model when one was active. */
  model?: string;

  /** Records the selected Pi thinking level when one was active. */
  thinking?: string;

  /** Records the active child tool names. */
  tools: readonly string[];

  /** Records when Side Quests created the child session. */
  createdAt: number;
}>;

/**
 * Records one unanswered child question for its parent.
 */
export type MailboxRequest = Readonly<{
  /** Records the session-store schema version. */
  version: typeof STORE_VERSION;

  /** Identifies this question for response correlation. */
  requestId: string;

  /** Identifies the child that asked the question. */
  childId: string;

  /** Records the question for the parent. */
  prompt: string;

  /** Records when the child wrote the question. */
  createdAt: number;
}>;

/**
 * Records one parent continuation or answer for a child.
 */
export type MailboxResponse = Readonly<{
  /** Records the session-store schema version. */
  version: typeof STORE_VERSION;

  /** Identifies this response delivery attempt. */
  responseId: string;

  /** Identifies the matching child question when this is an answer. */
  requestId?: string;

  /** Identifies the child that receives the response. */
  childId: string;

  /** Records the continuation prompt for the child. */
  prompt: string;

  /** Records when the parent wrote the response. */
  createdAt: number;
}>;

/**
 * Selects the manifest fields supplied when creating a child session.
 */
export type CreateSessionParams = Readonly<
  Omit<
    ChildManifest,
    "version" | "sessionPath" | "agentName" | "displayName" | "createdAt"
  > & {
    /** Records the parent session file to copy when context inheritance is on. */
    parentSessionPath?: string;
  }
>;

/**
 * Provides the Side Quests boundary to resumable child session state.
 */
export class SessionStore {
  /**
   * Creates a private child Pi session and its immutable manifest.
   */
  public static create(params: CreateSessionParams): ChildManifest {
    const path = SessionStore.sessionPath(params.parentId, params.childId);
    const inherited =
      params.inheritContext && params.parentSessionPath
        ? SessionStore.inheritedEntries(params.parentSessionPath)
        : [];

    // Pi's session header format
    const session = {
      type: "session",
      version: 3,
      id: params.childId,
      timestamp: new Date().toISOString(),
      cwd: params.cwd,
      parentSession: params.parentSessionPath,
    };

    JsonStore.writeLines(path, [session, ...inherited]);

    const manifest: ChildManifest = {
      version: STORE_VERSION,
      childId: params.childId,
      parentId: params.parentId,
      ownerId: params.ownerId,
      sessionPath: realpathSync(path),
      cwd: params.cwd,
      agentName: "general-purpose",
      displayName: "general-purpose",
      description: params.description,
      lifecycle: params.lifecycle,
      inheritContext: params.inheritContext,
      model: params.model,
      thinking: params.thinking,
      tools: params.tools,
      createdAt: Date.now(),
    };

    JsonStore.write(
      SessionStore.manifestPath(params.parentId, params.childId),
      manifest,
    );

    return manifest;
  }

  /**
   * Returns the directory where all Side Quests state is stored.
   */
  private static baseDirectory(): string {
    return join(
      process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
      "side-quests",
    );
  }

  /**
   * Returns the private directory for one child session and its mailbox.
   */
  private static sessionDirectory(parentId: string, childId: string): string {
    return join(SessionStore.baseDirectory(), "sessions", parentId, childId);
  }

  /**
   * Returns the private Pi session path for one child.
   */
  private static sessionPath(parentId: string, childId: string): string {
    return join(
      SessionStore.sessionDirectory(parentId, childId),
      "session.jsonl",
    );
  }

  /**
   * Returns the private manifest path for one child.
   */
  private static manifestPath(parentId: string, childId: string): string {
    return join(
      SessionStore.sessionDirectory(parentId, childId),
      "manifest.json",
    );
  }

  /**
   * Returns the private mailbox path for one child message direction.
   */
  private static mailboxPath(
    parentId: string,
    childId: string,
    name: "request" | "response",
  ): string {
    return join(
      SessionStore.sessionDirectory(parentId, childId),
      "mailbox",
      `${name}.json`,
    );
  }

  /**
   * Returns inherited parent-session entries without its session header.
   */
  private static inheritedEntries(parentPath: string): string[] {
    try {
      return readFileSync(parentPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .filter((line) => {
          try {
            return JSON.parse(line).type !== "session";
          } catch {
            return false;
          }
        });
    } catch {
      return [];
    }
  }
}
