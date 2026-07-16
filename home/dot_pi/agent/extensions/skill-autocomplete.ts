/**
 * Enabling inline auto-completion for skill commands (e.g. `/skill:...`)
 * by patching the TUI editor to trigger suggestions when typing slash-prefixed queries.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  type AutocompleteItem,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
  fuzzyFilter,
} from "@earendil-works/pi-tui";

type SkillCommand = {
  name: string;
  description?: string;
  source: string;
};

type InlineSkillContext = {
  slashCol: number;
  query: string;
};

const PATCH_STATE = Symbol.for("skill-autocomplete.patch");
const ALLOWED_BOUNDARY_CHARS = new Set(["(", "[", "{", '"', "'"]);
const INLINE_SKILL_QUERY_CHAR = /^[A-Za-z0-9:._-]$/;

function absoluteIndex(lines: string[], lineIndex: number, col: number) {
  let index = col;
  for (let i = 0; i < lineIndex; i++) {
    index += (lines[i] ?? "").length + 1;
  }
  return index;
}

function previousChar(lines: string[], lineIndex: number, col: number) {
  if (col > 0) return (lines[lineIndex] ?? "")[col - 1];
  return lineIndex > 0 ? "\n" : undefined;
}

function isAllowedBoundary(char: string | undefined) {
  return (
    char !== undefined && (/\s/.test(char) || ALLOWED_BOUNDARY_CHARS.has(char))
  );
}

function extractInlineSkillContext(
  lines: string[],
  cursorLine: number,
  cursorCol: number,
): InlineSkillContext | undefined {
  const line = lines[cursorLine] ?? "";
  const beforeCursor = line.slice(0, cursorCol);
  const slashCol = beforeCursor.lastIndexOf("/");
  if (slashCol < 0) return undefined;

  const query = beforeCursor.slice(slashCol + 1);
  if (query.includes("/") || /\s/.test(query)) return undefined;
  if (absoluteIndex(lines, cursorLine, slashCol) === 0) return undefined;
  if (!isAllowedBoundary(previousChar(lines, cursorLine, slashCol)))
    return undefined;

  return { slashCol, query };
}

function skillCommands(pi: ExtensionAPI): SkillCommand[] {
  return pi.getCommands().filter((command) => command.source === "skill");
}

function skillItem(command: SkillCommand): AutocompleteItem {
  return {
    value: `${command.name}`,
    label: `${command.name}`,
    ...(command.description ? { description: command.description } : {}),
  };
}

function filterSkills(
  commands: SkillCommand[],
  query: string,
): AutocompleteItem[] {
  if (query.trim() === "") return commands.map(skillItem);

  return fuzzyFilter(commands, query, (command) => {
    const skillName = command.name.startsWith("skill:")
      ? command.name.slice("skill:".length)
      : command.name;
    return `${skillName} ${command.name}`;
  }).map(skillItem);
}

function createSkillAutocompleteProvider(
  current: AutocompleteProvider,
  getSkillCommands: () => SkillCommand[],
): AutocompleteProvider {
  return {
    async getSuggestions(
      lines,
      cursorLine,
      cursorCol,
      options,
    ): Promise<AutocompleteSuggestions | null> {
      const context = extractInlineSkillContext(lines, cursorLine, cursorCol);
      if (!context) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      const items = filterSkills(getSkillCommands(), context.query);
      if (items.length === 0) return null;

      return {
        items,
        prefix: context.query,
      };
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      const context = extractInlineSkillContext(lines, cursorLine, cursorCol);
      if (context && item.value.startsWith("/skill:")) {
        const line = lines[cursorLine] ?? "";
        const newLines = [...lines];
        newLines[cursorLine] =
          line.slice(0, context.slashCol) + item.value + line.slice(cursorCol);
        return {
          lines: newLines,
          cursorLine,
          cursorCol: context.slashCol + item.value.length,
        };
      }

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

function patchEditorInlineSlashTrigger() {
  const prototype = Editor.prototype as any;
  if (prototype[PATCH_STATE]) return;

  const originalInsertCharacter = prototype.insertCharacter;
  if (typeof originalInsertCharacter !== "function") {
    throw new Error("Editor.insertCharacter not found");
  }

  prototype[PATCH_STATE] = { originalInsertCharacter };
  prototype.insertCharacter = function patchedInsertCharacter(
    char: string,
    skipUndoCoalescing?: boolean,
  ) {
    originalInsertCharacter.call(this, char, skipUndoCoalescing);

    if (typeof this.tryTriggerAutocomplete !== "function") return;
    if (this.autocompleteState) return;
    if (char !== "/" && !INLINE_SKILL_QUERY_CHAR.test(char)) return;
    if (
      !extractInlineSkillContext(
        this.state?.lines ?? [],
        this.state?.cursorLine ?? 0,
        this.state?.cursorCol ?? 0,
      )
    ) {
      return;
    }

    this.tryTriggerAutocomplete();
  };
}

export default function (pi: ExtensionAPI) {
  let cachedSkillCommands: SkillCommand[] = [];
  const refreshSkillCommands = () => {
    try {
      cachedSkillCommands = skillCommands(pi);
    } catch (error) {
      console.error("skill-autocomplete: failed to refresh skills", error);
    }
  };

  try {
    patchEditorInlineSlashTrigger();
  } catch (error) {
    console.error("skill-autocomplete: failed to patch editor", error);
  }

  pi.on("session_start", (_event, ctx) => {
    refreshSkillCommands();
    ctx.ui.addAutocompleteProvider((current) =>
      createSkillAutocompleteProvider(current, () => cachedSkillCommands),
    );
  });

  pi.on("resources_discover", refreshSkillCommands);
}
