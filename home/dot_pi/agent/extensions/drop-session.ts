/**
 * /drop — Delete current session and start fresh.
 *
 * Inspired by oh-my-pi's /drop command. Grabs current session file path,
 * creates a new session, then deletes the old session file from disk.
 */

import { unlink } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Confirm before dropping sessions with this many entries or more. */
const CONFIRM_THRESHOLD = 50;

export default function (pi: ExtensionAPI) {
  pi.registerCommand("drop", {
    description: "Drop current session and start a new one",
    handler: async (_args, ctx) => {
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

      const result = await ctx.newSession({
        withSession: async (newCtx) => {
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
        },
      });

      if (result.cancelled) {
        ctx.ui.notify("Session switch cancelled", "warning");
      }
    },
  });
}
