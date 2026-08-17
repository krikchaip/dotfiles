/**
 * Extend Pi's built-in /new command.
 *
 * /new \[--sp|--vsp|--win\] \[child\]
 *   - Bare /new keeps Pi's native behavior while idle.
 *   - Bare /new does nothing and warns the user while agent is streaming.
 *   - child creates a blank session linked to the current persisted session.
 *   - Alt+Shift+N creates a child session and preserves the editor draft.
 *   - --vsp opens a side-by-side tmux pane; --sp opens a top/bottom pane.
 *   - --win opens a new tmux window.
 *   - Tmux forms leave the source session untouched and may run while streaming.
 *   - Same-pane forms are blocked while streaming.
 */

import {
  getAgentDir,
  SessionManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteProvider, KeyId } from "@earendil-works/pi-tui";
import { spawn } from "node:child_process";
import {
  closeSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";

const NEW_CHILD_ACTION = "app.session.newChild";
const NEW_TMUX_SP_ACTION = "app.session.newTmuxSp";
const NEW_CHILD_TMUX_SP_ACTION = "app.session.newChildTmuxSp";
const NEW_TMUX_VSP_ACTION = "app.session.newTmuxVsp";
const NEW_CHILD_TMUX_VSP_ACTION = "app.session.newChildTmuxVsp";
const NEW_TMUX_WIN_ACTION = "app.session.newTmuxWin";
const NEW_CHILD_TMUX_WIN_ACTION = "app.session.newChildTmuxWin";
const ARGUMENT_HINT = "[--sp|--vsp|--win] [child]";
const USAGE = `Usage: /new ${ARGUMENT_HINT}`;

type TmuxTarget = "h" | "v" | "window";

type ParsedArgs = { target?: TmuxTarget; child: boolean } | { error: string };

type AutocompleteItem = {
  value: string;
  label: string;
  description: string;
};

type ShortcutBinding = {
  action: string;
  target?: TmuxTarget;
  child: boolean;
  defaultKeys: KeyId[];
  description: string;
};

const TMUX_KEYBINDINGS: ShortcutBinding[] = [
  {
    action: NEW_TMUX_SP_ACTION,
    target: "v",
    child: false,
    defaultKeys: ["alt+s"],
    description: "Start a session in a top/bottom tmux pane",
  },
  {
    action: NEW_CHILD_TMUX_SP_ACTION,
    target: "v",
    child: true,
    defaultKeys: ["alt+shift+s"],
    description: "Start a child session in a top/bottom tmux pane",
  },
  {
    action: NEW_TMUX_VSP_ACTION,
    target: "h",
    child: false,
    defaultKeys: ["alt+v"],
    description: "Start a session in a side-by-side tmux pane",
  },
  {
    action: NEW_CHILD_TMUX_VSP_ACTION,
    target: "h",
    child: true,
    defaultKeys: ["alt+shift+v"],
    description: "Start a child session in a side-by-side tmux pane",
  },
  {
    action: NEW_TMUX_WIN_ACTION,
    target: "window",
    child: false,
    defaultKeys: ["alt+w"],
    description: "Start a session in a new tmux window",
  },
  {
    action: NEW_CHILD_TMUX_WIN_ACTION,
    target: "window",
    child: true,
    defaultKeys: ["alt+shift+w"],
    description: "Start a child session in a new tmux window",
  },
];

function parseArgs(text: string): ParsedArgs | undefined {
  const trimmed = text.trim();
  if (trimmed === "/new") return { child: false };
  if (!trimmed.startsWith("/new ")) return undefined;

  const tokens = trimmed.slice(5).trim().split(/\s+/);
  let index = 0;
  let target: TmuxTarget | undefined;

  if (tokens[index] === "--sp" || tokens[index] === "--vsp") {
    target = tokens[index] === "--vsp" ? "h" : "v";
    index++;
  } else if (tokens[index] === "--win") {
    target = "window";
    index++;
  }

  let child = false;
  if (tokens[index] === "child") {
    child = true;
    index++;
  }

  if (index !== tokens.length) return { error: USAGE };
  return target ? { target, child } : { child };
}

function validSessionFile(path: string | undefined): path is string {
  if (!path) return false;

  let fd: number | undefined;
  try {
    const info = statSync(path);
    if (!info.isFile() || info.size === 0) return false;

    fd = openSync(path, "r");
    const buffer = Buffer.alloc(Math.min(info.size, 64 * 1024));
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    const content = buffer.toString("utf8", 0, bytesRead);
    const newline = content.indexOf("\n");
    if (newline < 0) return false;

    const header = JSON.parse(content.slice(0, newline)) as {
      type?: unknown;
      id?: unknown;
    };
    return header.type === "session" && typeof header.id === "string";
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function completionItems(prefix: string): AutocompleteItem[] | null {
  const options: AutocompleteItem[] = [
    {
      value: "--sp",
      label: "--sp",
      description: "Open a top/bottom tmux pane",
    },
    {
      value: "--vsp",
      label: "--vsp",
      description: "Open a side-by-side tmux pane",
    },
    {
      value: "--win",
      label: "--win",
      description: "Open a new tmux window",
    },
    {
      value: "child",
      label: "child",
      description: "Create a blank child session",
    },
  ];

  if (!prefix) return options;

  const targetMatch = prefix.match(/^(--sp|--vsp|--win)\s+(.*)$/);
  if (targetMatch) {
    const rest = targetMatch[2] ?? "";
    if (!"child".startsWith(rest)) return null;
    return [
      {
        value: `${targetMatch[1]} child`,
        label: "child",
        description: "Create a blank child session in the new tmux target",
      },
    ];
  }

  if (/\s/.test(prefix)) return null;
  const matches = options.filter((item) => item.value.startsWith(prefix));
  return matches.length > 0 ? matches : null;
}

function extendNewAutocomplete(
  current: AutocompleteProvider,
): AutocompleteProvider {
  return {
    triggerCharacters: current.triggerCharacters,
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const beforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
      const match = beforeCursor.match(/^\/new\s+(.*)$/);
      if (!match) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      const prefix = match[1] ?? "";
      const items = completionItems(prefix);
      return items ? { prefix, items } : null;
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      return current.applyCompletion(
        lines,
        cursorLine,
        cursorCol,
        item,
        prefix,
      );
    },
    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return (
        current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ??
        true
      );
    },
  };
}

const SHORTCUT_BINDINGS: ShortcutBinding[] = [
  {
    action: NEW_CHILD_ACTION,
    child: true,
    defaultKeys: ["alt+shift+n"],
    description: "Start a child session",
  },
  ...TMUX_KEYBINDINGS,
];

function configuredKeys(binding: ShortcutBinding): KeyId[] {
  try {
    const config = JSON.parse(
      readFileSync(join(getAgentDir(), "keybindings.json"), "utf8"),
    ) as Record<string, unknown>;
    const configured = config[binding.action];
    if (configured === undefined) return binding.defaultKeys;

    const keys = Array.isArray(configured) ? configured : [configured];
    return keys.filter((key): key is KeyId => typeof key === "string");
  } catch {
    return binding.defaultKeys;
  }
}

function piCommand(args: string[]) {
  const piEntry = process.argv[1];
  return piEntry ? [process.execPath, piEntry, ...args] : ["pi", ...args];
}

function tmuxEnvironmentArgs() {
  const args: string[] = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key === "TMUX" || key === "TMUX_PANE") continue;
    args.push("-e", `${key}=${value}`);
  }
  return args;
}

async function spawnTmuxTarget(
  ctx: ExtensionContext,
  target: TmuxTarget,
  child: boolean,
  parentSession: string | undefined,
) {
  if (!process.env.TMUX) {
    ctx.ui.notify("Not inside tmux; cannot split a pane", "warning");
    return;
  }

  if (child && !validSessionFile(parentSession)) {
    ctx.ui.notify(
      "Current session has no valid session file; cannot create a child session",
      "warning",
    );
    return;
  }

  const cwd = ctx.sessionManager.getCwd();
  const sessionDir = ctx.sessionManager.getSessionDir();
  const piArgs: string[] = [];
  if (sessionDir) piArgs.push("--session-dir", sessionDir);

  let createdChildFile: string | undefined;
  if (child) {
    try {
      const childSession = SessionManager.create(cwd, sessionDir || undefined, {
        parentSession,
      });
      createdChildFile = childSession.getSessionFile();
      if (!createdChildFile) throw new Error("No child session path allocated");

      const rewriteFile = (
        childSession as unknown as { _rewriteFile?: () => void }
      )._rewriteFile;
      if (typeof rewriteFile !== "function") {
        throw new Error("Pi cannot persist a blank child session");
      }
      rewriteFile.call(childSession);
      piArgs.push("--session", createdChildFile);
    } catch (error) {
      if (createdChildFile) {
        try {
          unlinkSync(createdChildFile);
        } catch {}
      }
      ctx.ui.notify(
        `Failed to create child session: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
      return;
    }
  }

  const command = piCommand(piArgs);
  const tmuxArgs = [
    target === "window" ? "new-window" : "split-window",
    ...(target === "h" ? ["-h"] : target === "v" ? ["-v"] : []),
    "-c",
    cwd,
    ...tmuxEnvironmentArgs(),
    ...command,
  ];

  const result = await new Promise<{ error?: Error; code?: number | null }>(
    (resolvePromise) => {
      const tmux = spawn("tmux", tmuxArgs, { stdio: "ignore" });
      let settled = false;
      tmux.on("error", (error) => {
        if (settled) return;
        settled = true;
        resolvePromise({ error });
      });
      tmux.on("exit", (code) => {
        if (settled) return;
        settled = true;
        resolvePromise({ code });
      });
    },
  );

  if (!result.error && result.code === 0) return;

  let cleanupError: unknown;
  if (createdChildFile) {
    try {
      unlinkSync(createdChildFile);
    } catch (error) {
      cleanupError = error;
    }
  }

  const failure = result.error
    ? String(result.error)
    : `tmux exited with code ${String(result.code)}`;
  ctx.ui.notify(`tmux target failed: ${failure}`, "error");
  if (cleanupError) {
    ctx.ui.notify(
      `Failed to remove unused child session: ${String(cleanupError)}`,
      "warning",
    );
  }
}

async function handleExtendedNew(
  ctx: ExtensionCommandContext,
  parsed: Exclude<ParsedArgs, { error: string }>,
) {
  if (!parsed.target && !ctx.isIdle()) {
    ctx.ui.notify(
      "Cannot run same-pane /new while agent is streaming",
      "warning",
    );
    return;
  }

  const parentSession = ctx.sessionManager.getSessionFile();
  if (parsed.child && !validSessionFile(parentSession)) {
    ctx.ui.notify(
      "Current session has no valid session file; cannot create a child session",
      "warning",
    );
    return;
  }

  if (parsed.target) {
    await spawnTmuxTarget(ctx, parsed.target, parsed.child, parentSession);
    return;
  }

  try {
    await ctx.newSession({
      parentSession: parsed.child ? parentSession : undefined,
      withSession: async (newCtx) => {
        newCtx.ui.notify(
          parsed.child ? "New child session started" : "New session started",
          "info",
        );
      },
    });
  } catch (error) {
    ctx.ui.notify(
      `Failed to create ${parsed.child ? "child " : ""}session: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
  }
}

function registerExtendedNewCommand(pi: ExtensionAPI) {
  pi.registerCommand("new", {
    description: "Start a new or child session in this pane or a tmux target",
    getArgumentCompletions: completionItems,
    handler: async (args, ctx) => {
      const trimmedArgs = args.trim();
      const parsed = parseArgs(`/new${trimmedArgs ? ` ${trimmedArgs}` : ""}`);
      if (!parsed) return;
      if ("error" in parsed) {
        ctx.ui.notify(parsed.error, "warning");
        return;
      }
      await handleExtendedNew(ctx, parsed);
    },
  });
}

export default function (pi: ExtensionAPI) {
  let commandRegistered = false;
  const ensureCommandRegistered = () => {
    if (commandRegistered) return;
    registerExtendedNewCommand(pi);
    commandRegistered = true;
  };

  for (const binding of SHORTCUT_BINDINGS) {
    for (const key of configuredKeys(binding)) {
      pi.registerShortcut(key, {
        description: binding.description,
        handler: async (ctx) => {
          if (binding.target) {
            await spawnTmuxTarget(
              ctx,
              binding.target,
              binding.child,
              ctx.sessionManager.getSessionFile(),
            );
            return;
          }

          // Shortcut contexts cannot replace the current session directly.
          ensureCommandRegistered();
          pi.sendUserMessage("/new child", {
            expandPromptTemplates: true,
          });
        },
      });
    }
  }

  pi.on("input", (event, ctx) => {
    const text = event.text.trim();
    if (ctx.mode !== "tui" || !text.startsWith("/new ")) return;

    ensureCommandRegistered();
    queueMicrotask(() => {
      if (event.streamingBehavior) {
        pi.sendUserMessage(text, {
          deliverAs: event.streamingBehavior,
          expandPromptTemplates: true,
        });
      } else {
        pi.sendUserMessage(text, { expandPromptTemplates: true });
      }
    });
    return { action: "handled" };
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.addAutocompleteProvider(extendNewAutocomplete);
  });
}
