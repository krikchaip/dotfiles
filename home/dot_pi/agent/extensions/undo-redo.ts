/**
 * Add /undo and /redo session navigation commands.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

type RedoFrame = {
  leafId: string | null;
  promptText?: string;
};

type UserEntry = {
  id: string;
  type: "message";
  parentId: string | null;
  message: {
    role: "user";
    content: unknown;
  };
};

const DEFAULT_UNDO_SHORTCUTS = ["alt+u"];
const DEFAULT_REDO_SHORTCUTS = ["alt+shift+u"];
const USER_KEYBINDINGS = join(homedir(), ".pi", "agent", "keybindings.json");

let redoStack: RedoFrame[] = [];
let ownedEditorText: string | undefined;
let internalNavigationDepth = 0;
let resetBeforeNextUndo = false;

function configuredShortcuts(key: string, defaults: string[]) {
  if (!existsSync(USER_KEYBINDINGS)) return defaults;

  try {
    const parsed = JSON.parse(readFileSync(USER_KEYBINDINGS, "utf8"));
    const value = parsed?.[key];

    if (typeof value === "string") return [value];
    if (
      Array.isArray(value) &&
      value.every((item) => typeof item === "string")
    ) {
      return value;
    }
    if (value === undefined) return defaults;
  } catch {
    return defaults;
  }

  return defaults;
}

function resetState() {
  redoStack = [];
  ownedEditorText = undefined;
  resetBeforeNextUndo = false;
}

function textFromContent(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .filter((block) => block?.type === "text")
    .map((block) => String(block.text ?? ""))
    .join("");
}

function hasImageContent(content: unknown) {
  return (
    Array.isArray(content) && content.some((block) => block?.type === "image")
  );
}

function latestUserEntryInPath(
  ctx: ExtensionCommandContext,
): UserEntry | undefined {
  const branch = ctx.sessionManager.getBranch();

  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i] as any;
    if (entry?.type === "message" && entry.message?.role === "user") {
      return entry as UserEntry;
    }
  }

  return undefined;
}

function editorAllowsNavigation(ctx: ExtensionContext) {
  const current = ctx.ui.getEditorText();
  return (
    current === "" ||
    (ownedEditorText !== undefined && current === ownedEditorText)
  );
}

function notifyDirtyEditor(ctx: ExtensionContext) {
  ctx.ui.notify("Editor not empty; clear it before undo/redo", "warning");
}

async function navigateWithoutSummary(
  ctx: ExtensionCommandContext,
  entryId: string,
) {
  internalNavigationDepth++;
  try {
    return await ctx.navigateTree(entryId, { summarize: false });
  } finally {
    internalNavigationDepth--;
  }
}

async function handleUndo(ctx: ExtensionCommandContext) {
  if (!ctx.isIdle()) {
    ctx.abort();
    await ctx.waitForIdle();
    resetState();
  }

  if (resetBeforeNextUndo) {
    resetBeforeNextUndo = false;
    resetState();
  }

  if (!editorAllowsNavigation(ctx)) {
    notifyDirtyEditor(ctx);
    return;
  }

  const leafId = ctx.sessionManager.getLeafId();
  if (leafId === null) {
    ctx.ui.notify("Nothing to undo", "info");
    return;
  }

  const userEntry = latestUserEntryInPath(ctx);
  if (!userEntry) {
    ctx.ui.notify("Nothing to undo", "info");
    return;
  }

  const promptText = textFromContent(userEntry.message.content);
  redoStack.push({
    leafId,
    ...(ownedEditorText !== undefined ? { promptText: ownedEditorText } : {}),
  });

  const result = await navigateWithoutSummary(ctx, userEntry.id);
  if (result.cancelled) {
    redoStack.pop();
    return;
  }

  ctx.ui.setEditorText(promptText);
  ownedEditorText = promptText;

  if (hasImageContent(userEntry.message.content)) {
    ctx.ui.notify(
      "Undo restored text only; images cannot be restored to editor",
      "warning",
    );
  }
}

async function handleRedo(ctx: ExtensionCommandContext) {
  if (!ctx.isIdle()) {
    ctx.ui.notify("Cannot redo while streaming", "warning");
    return;
  }

  if (!editorAllowsNavigation(ctx)) {
    notifyDirtyEditor(ctx);
    return;
  }

  while (redoStack.length > 0) {
    const frame = redoStack.pop()!;

    if (frame.leafId === null) {
      ctx.sessionManager.resetLeaf();
      ctx.ui.setEditorText(frame.promptText ?? "");
      ownedEditorText = frame.promptText;
      return;
    }

    const target = ctx.sessionManager.getEntry(frame.leafId) as any;
    if (!target) continue;

    if (target.type === "message" && target.message?.role === "user") {
      redoStack.push(frame);
      ctx.ui.notify("Cannot redo to user-message leaf", "warning");
      return;
    }

    const result = await navigateWithoutSummary(ctx, frame.leafId);
    if (result.cancelled) {
      redoStack.push(frame);
      return;
    }

    ctx.ui.setEditorText(frame.promptText ?? "");
    ownedEditorText = frame.promptText;
    return;
  }

  ownedEditorText = undefined;
  ctx.ui.notify("Nothing to redo", "info");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForShortcutIdle(ctx: ExtensionContext) {
  while (!ctx.isIdle()) await sleep(50);
}

async function triggerShortcutCommand(
  ctx: ExtensionContext,
  command: "undo" | "redo",
) {
  if (command === "redo" && !ctx.isIdle()) {
    ctx.ui.notify("Cannot redo while streaming", "warning");
    return;
  }

  if (!editorAllowsNavigation(ctx)) {
    notifyDirtyEditor(ctx);
    return;
  }

  if (command === "undo" && !ctx.isIdle()) {
    ctx.abort();
    resetBeforeNextUndo = true;
    await waitForShortcutIdle(ctx);
  }

  process.stdin.emit("data", Buffer.from(`\x03/${command}\r`));
}

function registerShortcutCommand(
  pi: ExtensionAPI,
  shortcut: string,
  command: "undo" | "redo",
) {
  pi.registerShortcut(shortcut, {
    description: `Run /${command}`,
    handler: async (ctx) => {
      await triggerShortcutCommand(ctx, command);
    },
  });
}

export default function (pi: ExtensionAPI) {
  const undoShortcuts = configuredShortcuts(
    "app.session.undo",
    DEFAULT_UNDO_SHORTCUTS,
  );
  const redoShortcuts = configuredShortcuts(
    "app.session.redo",
    DEFAULT_REDO_SHORTCUTS,
  );

  pi.registerCommand("undo", {
    description: "Undo to the latest user message in the current session path",
    handler: async (_args, ctx) => {
      await handleUndo(ctx);
    },
  });

  pi.registerCommand("redo", {
    description: "Redo the last undo navigation",
    handler: async (_args, ctx) => {
      await handleRedo(ctx);
    },
  });

  for (const shortcut of undoShortcuts) {
    registerShortcutCommand(pi, shortcut, "undo");
  }

  for (const shortcut of redoShortcuts) {
    registerShortcutCommand(pi, shortcut, "redo");
  }

  pi.on("session_start", (_event, ctx) => {
    resetState();

    if (
      !redoShortcuts.some(
        (shortcut) => shortcut.toLowerCase() === "alt+shift+u",
      )
    ) {
      return;
    }

    ctx.ui.onTerminalInput((data) => {
      if (data !== "\x1bU") return;

      setImmediate(() => {
        void triggerShortcutCommand(ctx, "redo");
      });

      return { consume: true };
    });
  });

  pi.on("session_shutdown", () => {
    resetState();
  });

  pi.on("session_tree", () => {
    if (internalNavigationDepth > 0) return;
    resetState();
  });

  pi.on("message_end", (event) => {
    if (event.message.role === "user") resetState();
  });
}
