/**
 * Skill references without prompt pollution.
 *
 * Native Pi expands whole-message `/skill:name` into full `SKILL.md` content.
 * This extension disables that expansion and leaves `/skill:name` markers in the
 * user's prompt unchanged. At provider-call time only, the `context` event adds
 * a hidden text block near content that mentions skills with resolved skill file
 * paths. Session history stays clean; resume/fork/retry reconstructs hidden
 * blocks transiently as long as referenced skills still exist.
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

type AssistantMessageLike = {
  role: "assistant";
  content: unknown[];
};

type ToolCallBlock = {
  type: "toolCall";
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
};

type ToolResultMessageLike = {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: string | unknown[];
};

type HiddenUserMessage = {
  role: "user";
  content: TextBlock[];
  timestamp: number;
};

const NATIVE_EXPANSION_PATCH_STATE = Symbol.for(
  "skill-expansion.native-expansion.patch",
);
const HIDDEN_LABEL = "referenced skill paths:";
const SKILL_MARKER_PATTERN =
  /(^|[^\w/-])\/skill:([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)(?=$|[^a-z0-9-])/g;
const SKILL_DOC_MARKER_PATTERN =
  /(^|[^\w/-])\/(?:skill:)?([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)(?=$|[^a-z0-9-])/g;

function absolutePath(filePath: string) {
  return isAbsolute(filePath) ? filePath : resolve(filePath);
}

function isTextBlock(block: unknown): block is TextBlock {
  return !!block && typeof block === "object" && (block as any).type === "text";
}

function isToolCallBlock(block: unknown): block is ToolCallBlock {
  return (
    !!block &&
    typeof block === "object" &&
    (block as any).type === "toolCall" &&
    typeof (block as any).id === "string" &&
    typeof (block as any).name === "string"
  );
}

function isAssistantMessage(message: unknown): message is AssistantMessageLike {
  return (
    (message as any)?.role === "assistant" &&
    Array.isArray((message as any).content)
  );
}

function isToolResultMessage(
  message: unknown,
): message is ToolResultMessageLike {
  return (
    (message as any)?.role === "toolResult" &&
    typeof (message as any).toolCallId === "string" &&
    typeof (message as any).toolName === "string" &&
    (typeof (message as any).content === "string" ||
      Array.isArray((message as any).content))
  );
}

function findReferencedSkills(
  text: string,
  skills: SkillLike[],
  includeBareMarkers = false,
): SkillReference[] {
  if (!text.includes(includeBareMarkers ? "/" : "/skill:")) return [];

  const skillsByName = new Map(skills.map((skill) => [skill.name, skill]));
  const seen = new Set<string>();
  const references: SkillReference[] = [];
  const source = includeBareMarkers
    ? SKILL_DOC_MARKER_PATTERN.source
    : SKILL_MARKER_PATTERN.source;
  const pattern = new RegExp(source, "g");

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

function isMarkdownPath(filePath: string) {
  return filePath.toLowerCase().endsWith(".md");
}

function readToolCallPaths(messages: unknown[], cwd: string) {
  const paths = new Map<string, string>();

  for (const message of messages) {
    if (!isAssistantMessage(message)) continue;

    for (const block of message.content) {
      if (!isToolCallBlock(block) || block.name !== "read") continue;

      const readPath = block.arguments?.path;
      if (typeof readPath !== "string") continue;

      paths.set(
        block.id,
        isAbsolute(readPath) ? readPath : resolve(cwd, readPath),
      );
    }
  }

  return paths;
}

function withHiddenUserSkillReferences<T>(message: T, skills: SkillLike[]): T {
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

function hiddenReadSkillReferenceMessage(
  message: unknown,
  skills: SkillLike[],
  readPaths: Map<string, string>,
): HiddenUserMessage | undefined {
  if (!isToolResultMessage(message) || message.toolName !== "read") return;

  const readPath = readPaths.get(message.toolCallId);
  if (!readPath || !isMarkdownPath(readPath)) return;

  const references = findReferencedSkills(
    textForSkillMatching(message.content),
    skills,
    true,
  ).filter((reference) => resolve(reference.filePath) !== resolve(readPath));
  if (references.length === 0) return;

  const hiddenBlock: TextBlock = {
    type: "text",
    text: formatSkillReferenceBlock(references),
    piSkillReferencePaths: true,
  };

  return {
    role: "user",
    content: [hiddenBlock],
    timestamp: Date.now(),
  };
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

  pi.on("context", (event, ctx) => {
    try {
      const skills = skillsFromCommands(pi);
      const readPaths = readToolCallPaths(event.messages, ctx.cwd);
      return {
        messages: event.messages.flatMap((message) => {
          const messageWithUserRefs = withHiddenUserSkillReferences(
            message,
            skills,
          );
          const hiddenMessage = hiddenReadSkillReferenceMessage(
            messageWithUserRefs,
            skills,
            readPaths,
          );
          return hiddenMessage
            ? [messageWithUserRefs, hiddenMessage]
            : [messageWithUserRefs];
        }),
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
