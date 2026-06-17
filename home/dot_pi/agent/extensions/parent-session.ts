/**
 * /parent — navigate and manage session parent links.
 *
 * - `/parent`: switch to the current session's parent session.
 * - `/parent --rm`: remove the current session's parent link.
 * - `/parent <uuid|first-segment>`: set the current session's parent link.
 *
 * Parent links live in the session header (`parentSession`). Setting/removing the
 * link rewrites only the first JSONL line; no conversation entries are changed.
 */

import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  SessionHeader,
  SessionInfo,
} from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";

type Header = SessionHeader & { [key: string]: unknown };
type ParentCommandResult = SessionInfo | { error: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_FIRST_SEGMENT_RE = /^[0-9a-f]{8}$/i;

function isSupportedSessionId(value: string) {
  return UUID_RE.test(value) || UUID_FIRST_SEGMENT_RE.test(value);
}

function formatSession(session: { name?: string; path: string }) {
  return session.name ? `${session.name} ${session.path}` : session.path;
}

async function readHeader(sessionPath: string): Promise<Header | undefined> {
  const content = await readFile(sessionPath, "utf8");
  const firstLine = content.split(/\r?\n/, 1)[0];
  if (!firstLine) return undefined;

  const parsed = JSON.parse(firstLine) as Header;
  return parsed.type === "session" ? parsed : undefined;
}

async function readSessionName(sessionPath: string) {
  const content = await readFile(sessionPath, "utf8");
  let name: string | undefined;

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as { type?: string; name?: string };
    if (entry.type === "session_info") name = entry.name;
  }

  return name || undefined;
}

async function writeParentSession(
  sessionPath: string,
  parentSession: string | undefined,
) {
  const content = await readFile(sessionPath, "utf8");
  const newlineIndex = content.indexOf("\n");
  const firstLine =
    newlineIndex === -1 ? content : content.slice(0, newlineIndex);
  const rest = newlineIndex === -1 ? "" : content.slice(newlineIndex);
  const header = JSON.parse(firstLine) as Header;

  if (header.type !== "session") {
    throw new Error(`Session file has invalid header: ${sessionPath}`);
  }

  if (parentSession) {
    header.parentSession = parentSession;
  } else {
    delete header.parentSession;
  }

  const mode = (await stat(sessionPath)).mode;
  const tmpPath = `${sessionPath}.parent-${process.pid}-${Date.now()}.tmp`;

  try {
    await writeFile(tmpPath, `${JSON.stringify(header)}${rest}`, { mode });
    await rename(tmpPath, sessionPath);
  } catch (error) {
    await unlink(tmpPath).catch(() => undefined);
    throw error;
  }
}

async function listCurrentSessions(ctx: ExtensionCommandContext) {
  return SessionManager.list(ctx.cwd, ctx.sessionManager.getSessionDir());
}

async function listAllSessions(ctx: ExtensionCommandContext) {
  const sessionManager = ctx.sessionManager as typeof ctx.sessionManager & {
    usesDefaultSessionDir?: () => boolean;
  };

  return sessionManager.usesDefaultSessionDir?.()
    ? SessionManager.listAll()
    : SessionManager.listAll(ctx.sessionManager.getSessionDir());
}

function matchesSessionId(session: SessionInfo, id: string) {
  return UUID_RE.test(id) ? session.id === id : session.id.startsWith(`${id}-`);
}

async function resolveTargetSession(
  args: string,
  ctx: ExtensionCommandContext,
): Promise<ParentCommandResult> {
  const currentMatches = (await listCurrentSessions(ctx)).filter((session) =>
    matchesSessionId(session, args),
  );

  if (currentMatches.length === 1) return currentMatches[0];
  if (currentMatches.length > 1) {
    return { error: `Ambiguous session id in current project: ${args}` };
  }

  const globalMatches = (await listAllSessions(ctx)).filter((session) =>
    matchesSessionId(session, args),
  );

  if (globalMatches.length === 1) return globalMatches[0];
  if (globalMatches.length > 1) {
    return { error: `Ambiguous session id globally: ${args}` };
  }

  return { error: `No session found matching: ${args}` };
}

async function wouldCreateCycle(targetPath: string, currentPath: string) {
  const current = resolve(currentPath);
  const seen = new Set<string>();
  let cursor: string | undefined = resolve(targetPath);

  while (cursor) {
    const resolvedCursor = resolve(cursor);
    if (resolvedCursor === current) return true;
    if (seen.has(resolvedCursor)) return false;
    seen.add(resolvedCursor);

    let header: Header | undefined;
    try {
      header = await readHeader(resolvedCursor);
    } catch {
      return false;
    }
    cursor =
      typeof header?.parentSession === "string"
        ? header.parentSession
        : undefined;
  }

  return false;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("parent", {
    description: "Jump to, set, or remove the current session parent link",
    handler: async (rawArgs, ctx) => {
      const args = rawArgs.trim();
      const currentPath = ctx.sessionManager.getSessionFile();

      if (!currentPath) {
        ctx.ui.notify(
          "Current session is ephemeral; no parent session",
          "warning",
        );
        return;
      }

      const header = ctx.sessionManager.getHeader();
      if (!header) {
        ctx.ui.notify("Current session has no header", "error");
        return;
      }

      if (!args) {
        const parentPath = header.parentSession;
        if (!parentPath) {
          ctx.ui.notify("No parent session linked", "warning");
          return;
        }

        try {
          await stat(parentPath);
        } catch {
          ctx.ui.notify(
            `Parent session missing or unreadable: ${parentPath}`,
            "warning",
          );
          return;
        }

        const result = await ctx.switchSession(parentPath, {
          withSession: async (newCtx) => {
            const switchedHeader = newCtx.sessionManager.getHeader();
            const label = switchedHeader?.id
              ? switchedHeader.id.split("-")[0]
              : parentPath;
            newCtx.ui.notify(`Switched to parent session: ${label}`, "info");
          },
        });

        if (result.cancelled) {
          ctx.ui.notify("Parent session switch cancelled", "warning");
        }
        return;
      }

      if (args === "--rm") {
        const parentPath = header.parentSession;
        if (!parentPath) {
          ctx.ui.notify("No parent session linked", "warning");
          return;
        }

        await writeParentSession(currentPath, undefined);
        delete header.parentSession;

        let name: string | undefined;
        try {
          name = await readSessionName(parentPath);
        } catch {
          name = undefined;
        }

        ctx.ui.notify(
          `Removed parent link: ${formatSession({ name, path: parentPath })}`,
          "info",
        );
        return;
      }

      if (!isSupportedSessionId(args)) {
        ctx.ui.notify("Usage: /parent [--rm|<session-id>]", "warning");
        return;
      }

      const target = await resolveTargetSession(args, ctx);
      if ("error" in target) {
        ctx.ui.notify(target.error, "warning");
        return;
      }

      const targetPath = resolve(target.path);
      const resolvedCurrentPath = resolve(currentPath);
      if (targetPath === resolvedCurrentPath) {
        ctx.ui.notify("Current session cannot be its own parent", "warning");
        return;
      }

      if (await wouldCreateCycle(targetPath, resolvedCurrentPath)) {
        ctx.ui.notify("Parent link would create a cycle", "warning");
        return;
      }

      await writeParentSession(currentPath, targetPath);
      header.parentSession = targetPath;
      ctx.ui.notify(`Parent session set: ${formatSession(target)}`, "info");
    },
  });
}
