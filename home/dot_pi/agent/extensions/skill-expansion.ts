/**
 * Skill references without prompt pollution.
 *
 * Native Pi expands whole-message `/skill:name` into full `SKILL.md` content.
 * This extension disables that expansion and leaves `/skill:name` markers in the
 * user's prompt unchanged. At provider-call time only, the `context` event adds
 * a hidden text block to the same user message content array with resolved skill
 * file paths. Session history stays clean; resume/fork/retry reconstructs the
 * hidden block transiently as long as referenced skills still exist.
 */

import {
  AgentSession,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { isAbsolute, resolve } from "node:path";

type SkillLike = {
  name: string;
  filePath: string;
};

type SkillReference = {
  name: string;
  filePath: string;
};

type TextBlock = {
  type: "text";
  text: string;
  piSkillReferencePaths?: true;
};

type UserMessageLike = {
  role: "user";
  content: string | unknown[];
};

const NATIVE_EXPANSION_PATCH_STATE = Symbol.for(
  "skill-expansion.native-expansion.patch",
);
const HIDDEN_LABEL = "referenced skill paths:";
const SKILL_MARKER_PATTERN =
  /(^|[^\w/-])\/skill:([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)(?=$|[^a-z0-9-])/g;

function absolutePath(filePath: string) {
  return isAbsolute(filePath) ? filePath : resolve(filePath);
}

function isTextBlock(block: unknown): block is TextBlock {
  return !!block && typeof block === "object" && (block as any).type === "text";
}

function findReferencedSkills(
  text: string,
  skills: SkillLike[],
): SkillReference[] {
  if (!text.includes("/skill:")) return [];

  const skillsByName = new Map(skills.map((skill) => [skill.name, skill]));
  const seen = new Set<string>();
  const references: SkillReference[] = [];

  const pattern = new RegExp(SKILL_MARKER_PATTERN.source, "g");
  for (const match of text.matchAll(pattern)) {
    const name = match[2];
    if (!name || seen.has(name)) continue;

    const skill = skillsByName.get(name);
    if (!skill) continue;

    seen.add(name);
    references.push({ name, filePath: absolutePath(skill.filePath) });
  }

  return references;
}

function textForSkillMatching(content: string | unknown[]) {
  if (typeof content === "string") return content;
  return content
    .filter(
      (block): block is TextBlock =>
        isTextBlock(block) && !block.piSkillReferencePaths,
    )
    .map((block) => block.text)
    .join("\n");
}

function skillsFromCommands(pi: ExtensionAPI): SkillLike[] {
  return pi
    .getCommands()
    .filter((command) => command.source === "skill")
    .map((command) => ({
      name: command.name.startsWith("skill:")
        ? command.name.slice("skill:".length)
        : command.name,
      filePath: command.sourceInfo.path,
    }));
}

function formatSkillReferenceBlock(references: SkillReference[]) {
  const lines = references.map(
    (reference) => `- \`${reference.name}\` -> \`${reference.filePath}\``,
  );
  return `${HIDDEN_LABEL}\n${lines.join("\n")}`;
}

function hasSkillReferenceBlock(content: unknown[]) {
  return content.some(
    (block) => isTextBlock(block) && block.piSkillReferencePaths === true,
  );
}

function withHiddenSkillReferences<T>(message: T, skills: SkillLike[]): T {
  if ((message as any)?.role !== "user") return message;

  const userMessage = message as UserMessageLike;
  const references = findReferencedSkills(
    textForSkillMatching(userMessage.content),
    skills,
  );
  if (references.length === 0) return message;

  const hiddenBlock: TextBlock = {
    type: "text",
    text: formatSkillReferenceBlock(references),
    piSkillReferencePaths: true,
  };

  if (Array.isArray(userMessage.content)) {
    if (hasSkillReferenceBlock(userMessage.content)) return message;
    return {
      ...(message as object),
      content: [...userMessage.content, hiddenBlock],
    } as T;
  }

  return {
    ...(message as object),
    content: [{ type: "text", text: userMessage.content }, hiddenBlock],
  } as T;
}

function patchNativeSkillExpansion() {
  const prototype = AgentSession.prototype as any;
  if (prototype[NATIVE_EXPANSION_PATCH_STATE]) return;

  if (typeof prototype._expandSkillCommand !== "function") {
    throw new Error("AgentSession._expandSkillCommand not found");
  }

  prototype[NATIVE_EXPANSION_PATCH_STATE] = true;

  prototype._expandSkillCommand = function patchedExpandSkillCommand(
    text: string,
  ) {
    return text;
  };
}

export default function (pi: ExtensionAPI) {
  try {
    patchNativeSkillExpansion();
  } catch (error) {
    console.error(
      "skill-expansion: failed to patch native skill expansion",
      error,
    );
  }

  pi.on("context", (event) => {
    try {
      const skills = skillsFromCommands(pi);
      return {
        messages: event.messages.map((message) =>
          withHiddenSkillReferences(message, skills),
        ),
      };
    } catch (error) {
      console.error(
        "skill-expansion: failed to add hidden skill references",
        error,
      );
      return undefined;
    }
  });
}
