/**
 * Extend Pi's built-in /new command.
 *
 * /new \[--sp|--vsp\] \[child\]
 *   - Bare /new keeps Pi's native behavior while idle.
 *   - child creates a blank session linked to the current persisted session.
 *   - --vsp opens a side-by-side tmux pane; --sp opens a top/bottom pane.
 *   - Split forms leave the source session untouched and may run while streaming.
 *   - Same-pane forms are blocked while streaming.
 */

import {
  SessionManager,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import {
  closeSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const PATCH_STATE = Symbol.for("pi.extended-new.patch-state");
const ARGUMENT_HINT = "[--sp|--vsp] [child]";
const USAGE = `Usage: /new ${ARGUMENT_HINT}`;

type Split = "h" | "v";

type ParsedArgs = { split?: Split; child: boolean } | { error: string };

type AutocompleteItem = {
  value: string;
  label: string;
  description: string;
};

type PatchedInteractiveMode = {
  setupEditorSubmitHandler(...args: unknown[]): unknown;
  createBaseAutocompleteProvider(...args: unknown[]): unknown;
  defaultEditor?: { onSubmit?: (text: string) => Promise<unknown> | unknown };
  editor?: { setText?(text: string): void };
  runtimeHost?: {
    newSession(options?: { parentSession?: string }): Promise<{
      cancelled: boolean;
    }>;
  };
  session?: {
    isStreaming?: boolean;
    sessionManager?: {
      getCwd(): string;
      getSessionFile(): string | undefined;
      getSessionDir(): string;
    };
  };
  sessionManager?: {
    getCwd(): string;
    getSessionFile(): string | undefined;
    getSessionDir(): string;
  };
  clearStatusIndicator?(): void;
  showError?(message: string): void;
  showStatus?(message: string): void;
  showWarning?(message: string): void;
};

type PatchState = {
  originalSetupEditorSubmitHandler: (...args: unknown[]) => unknown;
  originalCreateBaseAutocompleteProvider: (...args: unknown[]) => unknown;
};

function parseArgs(text: string): ParsedArgs | undefined {
  const trimmed = text.trim();
  if (trimmed === "/new") return { child: false };
  if (!trimmed.startsWith("/new ")) return undefined;

  const tokens = trimmed.slice(5).trim().split(/\s+/);
  let index = 0;
  let split: Split | undefined;

  if (tokens[index] === "--sp" || tokens[index] === "--vsp") {
    split = tokens[index] === "--vsp" ? "h" : "v";
    index++;
  }

  let child = false;
  if (tokens[index] === "child") {
    child = true;
    index++;
  }

  if (index !== tokens.length) return { error: USAGE };
  return split ? { split, child } : { child };
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
      value: "child",
      label: "child",
      description: "Create a blank child session",
    },
  ];

  if (!prefix) return options;

  const splitMatch = prefix.match(/^(--sp|--vsp)\s+(.*)$/);
  if (splitMatch) {
    const rest = splitMatch[2] ?? "";
    if (!"child".startsWith(rest)) return null;
    return [
      {
        value: `${splitMatch[1]} child`,
        label: "child",
        description: "Create a blank child session in the new pane",
      },
    ];
  }

  if (/\s/.test(prefix)) return null;
  const matches = options.filter((item) => item.value.startsWith(prefix));
  return matches.length > 0 ? matches : null;
}

function patchNewAutocomplete(provider: unknown) {
  const commands = (provider as { commands?: unknown[] })?.commands;
  if (!Array.isArray(commands)) {
    throw new Error(
      "Combined autocomplete provider no longer exposes commands",
    );
  }

  const command = commands.find((item) => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as { name?: unknown; value?: unknown };
    return candidate.name === "new" || candidate.value === "new";
  }) as
    | {
        argumentHint?: string;
        getArgumentCompletions?: (prefix: string) => AutocompleteItem[] | null;
      }
    | undefined;

  if (!command) throw new Error("Built-in /new autocomplete entry not found");
  command.argumentHint = ARGUMENT_HINT;
  command.getArgumentCompletions = completionItems;
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

async function spawnTmuxPane(
  mode: PatchedInteractiveMode,
  split: Split,
  child: boolean,
  parentSession: string | undefined,
) {
  if (!process.env.TMUX) {
    mode.showWarning?.("Not inside tmux; cannot split a pane");
    return;
  }

  const sessionManager = mode.sessionManager ?? mode.session?.sessionManager;
  if (!sessionManager) {
    mode.showError?.("Current session manager unavailable");
    return;
  }

  if (child && !validSessionFile(parentSession)) {
    mode.showWarning?.(
      "Current session has no valid session file; cannot create a child session",
    );
    return;
  }

  const cwd = sessionManager.getCwd();
  const sessionDir = sessionManager.getSessionDir();
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
      piArgs.push("--session", childSession.getSessionId());
    } catch (error) {
      if (createdChildFile) {
        try {
          unlinkSync(createdChildFile);
        } catch {}
      }
      mode.showError?.(
        `Failed to create child session: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
  }

  const command = piCommand(piArgs);
  const tmuxArgs = [
    "split-window",
    split === "h" ? "-h" : "-v",
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
  mode.showError?.(`tmux split failed: ${failure}`);
  if (cleanupError) {
    mode.showWarning?.(
      `Failed to remove unused child session: ${String(cleanupError)}`,
    );
  }
}

async function handleExtendedNew(
  mode: PatchedInteractiveMode,
  parsed: Exclude<ParsedArgs, { error: string }>,
) {
  const streaming = Boolean(mode.session?.isStreaming);
  if (!parsed.split && streaming) {
    mode.showWarning?.("Cannot run same-pane /new while agent is streaming");
    return;
  }

  const sessionManager = mode.sessionManager ?? mode.session?.sessionManager;
  const parentSession = sessionManager?.getSessionFile();

  if (parsed.child && !validSessionFile(parentSession)) {
    mode.showWarning?.(
      "Current session has no valid session file; cannot create a child session",
    );
    return;
  }

  if (parsed.split) {
    await spawnTmuxPane(mode, parsed.split, parsed.child, parentSession);
    return;
  }

  if (!parsed.child) {
    throw new Error("Bare idle /new must use Pi's native handler");
  }

  if (!mode.runtimeHost) {
    mode.showError?.("Pi session runtime unavailable");
    return;
  }

  mode.clearStatusIndicator?.();
  try {
    const result = await mode.runtimeHost.newSession({ parentSession });
    if (result.cancelled) return;
    mode.showStatus?.("New child session started");
  } catch (error) {
    mode.showError?.(
      `Failed to create child session: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function installPatch(InteractiveMode: { prototype: PatchedInteractiveMode }) {
  const prototype = InteractiveMode.prototype as PatchedInteractiveMode & {
    [PATCH_STATE]?: PatchState;
  };
  if (prototype[PATCH_STATE]) return;

  if (typeof prototype.setupEditorSubmitHandler !== "function") {
    throw new Error("InteractiveMode.setupEditorSubmitHandler unavailable");
  }
  if (typeof prototype.createBaseAutocompleteProvider !== "function") {
    throw new Error(
      "InteractiveMode.createBaseAutocompleteProvider unavailable",
    );
  }

  const state: PatchState = {
    originalSetupEditorSubmitHandler: prototype.setupEditorSubmitHandler,
    originalCreateBaseAutocompleteProvider:
      prototype.createBaseAutocompleteProvider,
  };
  prototype[PATCH_STATE] = state;

  prototype.createBaseAutocompleteProvider = function (
    this: PatchedInteractiveMode,
    ...args: unknown[]
  ) {
    const provider = state.originalCreateBaseAutocompleteProvider.apply(
      this,
      args,
    );
    patchNewAutocomplete(provider);
    return provider;
  };

  prototype.setupEditorSubmitHandler = function (
    this: PatchedInteractiveMode,
    ...args: unknown[]
  ) {
    const result = state.originalSetupEditorSubmitHandler.apply(this, args);
    const nativeOnSubmit = this.defaultEditor?.onSubmit;
    if (typeof nativeOnSubmit !== "function") {
      throw new Error("Interactive editor submit handler unavailable");
    }

    this.defaultEditor!.onSubmit = async (text: string) => {
      const parsed = parseArgs(text);
      if (!parsed) return nativeOnSubmit(text);

      this.editor?.setText?.("");
      if ("error" in parsed) {
        this.showWarning?.(parsed.error);
        return;
      }

      if (!parsed.split && !parsed.child && !this.session?.isStreaming) {
        return nativeOnSubmit(text);
      }

      await handleExtendedNew(this, parsed);
    };

    return result;
  };
}

export default function (_pi: ExtensionAPI) {
  const req = createRequire(__filename);
  const cliEntry = process.argv[1];
  if (!cliEntry) throw new Error("Cannot locate Pi CLI entry");

  const distPath = dirname(realpathSync(cliEntry));
  const { InteractiveMode } = req(
    join(distPath, "modes", "interactive", "interactive-mode.js"),
  ) as { InteractiveMode?: { prototype: PatchedInteractiveMode } };

  if (!InteractiveMode) throw new Error("Cannot load Pi InteractiveMode");
  installPatch(InteractiveMode);
}
