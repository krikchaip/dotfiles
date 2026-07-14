/**
 * /drop \[-q|--quit\] — Delete current session and start fresh.
 *
 * Inspired by oh-my-pi's /drop command. Grabs current session file path,
 * creates a new session (or switches to parent session), then deletes
 * the old session file from disk. With -q/--quit, only inside tmux, also
 * closes the current pane after dropping.
 */

import { spawn } from "node:child_process";
import { unlink } from "node:fs/promises";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

/** Confirm before dropping sessions with this many entries or more. */
const CONFIRM_THRESHOLD = 100;

function isInTmux(): boolean {
  return Boolean(process.env.TMUX);
}

function closeTmuxPane(ctx: ExtensionCommandContext) {
  const child = spawn("tmux", ["kill-pane"], { stdio: "ignore" });
  child.on("error", (error) => {
    ctx.ui.notify(`Failed to close tmux pane: ${String(error)}`, "error");
  });
}

function parseArgs(args: string): { quit: boolean } | undefined {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { quit: false };
  if (tokens.length === 1 && (tokens[0] === "-q" || tokens[0] === "--quit")) {
    return { quit: true };
  }
  return undefined;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("drop", {
    description:
      "Drop current session and start a new one; -q closes tmux pane",
    getArgumentCompletions: (prefix) => {
      const value = prefix.trim();
      if (/\s/.test(value)) return null;

      const items = [
        {
          value: "-q",
          label: "-q",
          description: "Drop session and close current tmux pane",
        },
        {
          value: "--quit",
          label: "--quit",
          description: "Drop session and close current tmux pane",
        },
      ].filter((item) => item.value.startsWith(value));
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      const options = parseArgs(args);
      if (!options) {
        ctx.ui.notify("Usage: /drop [-q|--quit]", "warning");
        return;
      }
      if (options.quit && !isInTmux()) {
        ctx.ui.notify("Not inside tmux; use /drop instead", "warning");
        return;
      }

      const sessionFile = ctx.sessionManager.getSessionFile();
      if (!sessionFile) {
        ctx.ui.notify("Nothing to drop (in-memory session)", "warning");
        return;
      }

      const entries = ctx.sessionManager.getEntries();
      if (entries.length >= CONFIRM_THRESHOLD) {
        const ok = await ctx.ui.confirm(
          "Drop session",
          `Session has ${entries.length} entries. Drop anyway?`,
        );
        if (!ok) return;
      }

      const fileToDelete = sessionFile;
      const header = ctx.sessionManager.getHeader();
      const parentSession = header?.parentSession;

      const switchOpts = {
        withSession: async (newCtx: typeof ctx) => {
          try {
            await unlink(fileToDelete);
          } catch (err: unknown) {
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
              newCtx.ui.notify(
                `Failed to delete session file: ${err}`,
                "error",
              );
            }
          }
          newCtx.ui.notify("Session dropped", "info");
          if (options.quit) closeTmuxPane(newCtx);
        },
      };

      const result = parentSession
        ? await ctx.switchSession(parentSession, switchOpts)
        : await ctx.newSession(switchOpts);

      if (result.cancelled) {
        ctx.ui.notify("Session switch cancelled", "warning");
      }
    },
  });
}
