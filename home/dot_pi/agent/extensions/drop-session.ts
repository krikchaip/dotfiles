/**
 * /drop \[-q|--quit\] — Delete current session and start fresh.
 *
 * Inspired by oh-my-pi's /drop command. Grabs current session file path,
 * creates a new session (or switches to parent session), then deletes
 * the old session file from disk. With -q/--quit, only inside tmux, also
 * closes the current pane after dropping.
 */

import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

/** Confirm before dropping sessions with this many entries or more. */
const CONFIRM_THRESHOLD = 100;
const STREAMING_WARNING = "Cannot drop session while agent is streaming";
const PATCH_STATE = Symbol.for("pi.drop-session.patch-state");

const DROP_SHORTCUTS: ReadonlyArray<{
  action: string;
  args: string;
  defaultKeys: string[];
  description: string;
}> = [
  {
    action: "app.session.drop",
    args: "",
    defaultKeys: ["alt+q"],
    description: "Drop the current session",
  },
  {
    action: "app.session.dropTmuxQuit",
    args: " -q",
    defaultKeys: ["alt+shift+q"],
    description: "Drop the current session and close the tmux pane",
  },
];

type DropInteractiveMode = {
  setupEditorSubmitHandler(...args: unknown[]): unknown;
  defaultEditor?: {
    onAction?(action: string, handler: () => void): void;
    onSubmit?: (text: string) => Promise<unknown> | unknown;
  };
  keybindings?: {
    definitions?: Record<
      string,
      { defaultKeys: string[]; description: string }
    >;
    rebuild?(): void;
  };
};

type DropPatchState = {
  originalSetupEditorSubmitHandler: (...args: unknown[]) => unknown;
};

function installDropKeybindings(mode: DropInteractiveMode) {
  const keybindings = mode.keybindings;
  if (!keybindings?.definitions) {
    throw new Error("Interactive keybindings unavailable");
  }

  let changed = false;
  for (const { action, defaultKeys, description } of DROP_SHORTCUTS) {
    if (keybindings.definitions[action]) continue;
    keybindings.definitions[action] = { defaultKeys, description };
    changed = true;
  }
  if (changed) keybindings.rebuild?.();
}

function installDropShortcutAdapter(
  InteractiveMode: { prototype: DropInteractiveMode },
) {
  const prototype = InteractiveMode.prototype as DropInteractiveMode & {
    [PATCH_STATE]?: DropPatchState;
  };
  if (prototype[PATCH_STATE]) return;
  if (typeof prototype.setupEditorSubmitHandler !== "function") {
    throw new Error("InteractiveMode.setupEditorSubmitHandler unavailable");
  }

  const state: DropPatchState = {
    originalSetupEditorSubmitHandler: prototype.setupEditorSubmitHandler,
  };
  prototype[PATCH_STATE] = state;
  prototype.setupEditorSubmitHandler = function (
    this: DropInteractiveMode,
    ...args: unknown[]
  ) {
    const result = state.originalSetupEditorSubmitHandler.apply(this, args);
    const onSubmit = this.defaultEditor?.onSubmit;
    const onAction = this.defaultEditor?.onAction;
    if (typeof onSubmit !== "function" || typeof onAction !== "function") {
      throw new Error("Interactive editor actions unavailable");
    }

    installDropKeybindings(this);
    for (const shortcut of DROP_SHORTCUTS) {
      onAction.call(this.defaultEditor, shortcut.action, () => {
        void onSubmit(`/drop${shortcut.args}`);
      });
    }
    return result;
  };
}

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
  const cliEntry = process.argv[1];
  if (!cliEntry) throw new Error("Cannot locate Pi CLI entry");

  const req = createRequire(__filename);
  const distPath = dirname(realpathSync(cliEntry));
  const { InteractiveMode } = req(
    join(distPath, "modes", "interactive", "interactive-mode.js"),
  ) as { InteractiveMode?: { prototype: DropInteractiveMode } };
  if (!InteractiveMode) throw new Error("Cannot load Pi InteractiveMode");
  installDropShortcutAdapter(InteractiveMode);

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
      if (!ctx.isIdle()) {
        ctx.ui.notify(STREAMING_WARNING, "warning");
        return;
      }

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

      if (!ctx.isIdle()) {
        ctx.ui.notify(STREAMING_WARNING, "warning");
        return;
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
