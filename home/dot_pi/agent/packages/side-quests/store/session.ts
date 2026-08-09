import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

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
   * Reads and validates the manifest beside a child session file.
   */
  public static readManifest(sessionPath: string): ChildManifest | undefined {
    return SessionStore.readManifestFile(
      join(dirname(sessionPath), "manifest.json"),
    );
  }

  /**
   * Updates the mutable description and lifecycle of a child manifest.
   */
  public static updateManifest(
    manifest: ChildManifest,
    update: Pick<ChildManifest, "description" | "lifecycle">,
  ): ChildManifest {
    const next: ChildManifest = { ...manifest, ...update };

    JsonStore.write(
      SessionStore.manifestPath(next.parentId, next.childId),
      next,
    );

    return next;
  }

  /**
   * Writes a child question to its private request mailbox.
   */
  public static writeRequest(
    parentId: string,
    request: Omit<MailboxRequest, "version">,
  ): void {
    JsonStore.write(
      SessionStore.mailboxPath(parentId, request.childId, "request"),
      { version: STORE_VERSION, ...request },
    );
  }

  /**
   * Reads and validates a child question from its request mailbox.
   */
  public static readRequest(
    parentId: string,
    childId: string,
  ): MailboxRequest | undefined {
    const value = JsonStore.readRecord(
      SessionStore.mailboxPath(parentId, childId, "request"),
    );

    if (!value || value.version !== STORE_VERSION) return undefined;

    if (
      typeof value.requestId !== "string" ||
      value.childId !== childId ||
      typeof value.prompt !== "string" ||
      !Number.isFinite(value.createdAt)
    )
      return undefined;

    return value as unknown as MailboxRequest;
  }

  /**
   * Reports whether a request mailbox file exists for a child.
   */
  public static hasRequest(parentId: string, childId: string): boolean {
    return JsonStore.exists(
      SessionStore.mailboxPath(parentId, childId, "request"),
    );
  }

  /**
   * Removes a child question from its private request mailbox.
   */
  public static clearRequest(parentId: string, childId: string): void {
    JsonStore.remove(SessionStore.mailboxPath(parentId, childId, "request"));
  }

  /**
   * Writes a parent continuation or answer to a child response mailbox.
   */
  public static writeResponse(
    parentId: string,
    response: Omit<MailboxResponse, "version">,
  ): void {
    JsonStore.write(
      SessionStore.mailboxPath(parentId, response.childId, "response"),
      { version: STORE_VERSION, ...response },
    );
  }

  /**
   * Reads and validates a parent response from a child response mailbox.
   */
  public static readResponse(
    parentId: string,
    childId: string,
  ): MailboxResponse | undefined {
    const value = JsonStore.readRecord(
      SessionStore.mailboxPath(parentId, childId, "response"),
    );

    if (!value || value.version !== STORE_VERSION) return undefined;

    if (
      typeof value.responseId !== "string" ||
      (value.requestId !== undefined && typeof value.requestId !== "string") ||
      value.childId !== childId ||
      typeof value.prompt !== "string" ||
      !Number.isFinite(value.createdAt)
    )
      return undefined;

    return value as unknown as MailboxResponse;
  }

  /**
   * Removes a parent response from a child's private response mailbox.
   */
  public static clearResponse(parentId: string, childId: string): void {
    JsonStore.remove(SessionStore.mailboxPath(parentId, childId, "response"));
  }

  /**
   * Reads a manifest only when its path is safe for child resumption.
   */
  public static readResumableManifest(path: string): ChildManifest | undefined {
    if (!isAbsolute(path)) return undefined;

    try {
      const actual = realpathSync(path);
      const root = realpathSync(SessionStore.baseDirectory());

      if (
        relative(root, actual).startsWith("..") ||
        relative(root, actual) === "" ||
        !statSync(actual).isFile() ||
        lstatSync(path).isSymbolicLink()
      )
        return undefined;

      const manifest = SessionStore.readManifestFile(
        join(dirname(actual), "manifest.json"),
      );

      if (
        !manifest ||
        resolve(manifest.sessionPath) !== actual ||
        basename(actual) !== "session.jsonl"
      )
        return undefined;

      const expected = realpathSync(
        SessionStore.sessionPath(manifest.parentId, manifest.childId),
      );

      return expected === actual ? manifest : undefined;
    } catch {
      return undefined;
    }
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
   * Reads and validates a manifest from its private file path.
   */
  private static readManifestFile(path: string): ChildManifest | undefined {
    const value = JsonStore.readRecord(path);

    if (
      !value ||
      value.version !== STORE_VERSION ||
      value.agentName !== "general-purpose"
    )
      return undefined;

    const strings = [
      "childId",
      "parentId",
      "ownerId",
      "sessionPath",
      "cwd",
      "displayName",
      "description",
    ];

    if (
      (value.model !== undefined && typeof value.model !== "string") ||
      (value.thinking !== undefined && typeof value.thinking !== "string") ||
      !Array.isArray(value.tools) ||
      value.tools.some((tool) => typeof tool !== "string")
    )
      return undefined;

    if (strings.some((key) => typeof value[key] !== "string" || !value[key]))
      return undefined;

    if (value.lifecycle !== "autonomous" && value.lifecycle !== "interactive")
      return undefined;

    if (
      typeof value.inheritContext !== "boolean" ||
      !Number.isFinite(value.createdAt)
    )
      return undefined;

    return value as unknown as ChildManifest;
  }

  /**
   * Returns inherited parent-session entries without its session header.
   */
  private static inheritedEntries(parentPath: string): unknown[] {
    try {
      return readFileSync(parentPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .flatMap((line) => {
          try {
            const entry = JSON.parse(line) as unknown;
            const isSessionHeader =
              typeof entry === "object" &&
              (entry as { type?: unknown }).type === "session";

            return entry === null || isSessionHeader ? [] : [entry];
          } catch {
            return [];
          }
        });
    } catch {
      return [];
    }
  }
}
