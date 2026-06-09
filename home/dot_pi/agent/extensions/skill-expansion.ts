/**
 * Detect inline `/skill:name` references and appending their
 * absolute file paths as a footer map, facilitating skill discovery for the LLM.
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

const PATCH_STATE = Symbol.for("skill-expansion.patch");
const FOOTER_LABEL = "referenced skill paths:";
const SKILL_MARKER_PATTERN =
  /(^|[^\w/-])\/skill:([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)(?=$|[^a-z0-9-])/g;

function absolutePath(filePath: string) {
  return isAbsolute(filePath) ? filePath : resolve(filePath);
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

function appendReferencedSkillPaths(text: string, skills: SkillLike[]) {
  const references = findReferencedSkills(text, skills);
  if (references.length === 0) return text;

  const lines = references.map(
    (reference) => `- \`${reference.name}\` -> \`${reference.filePath}\``,
  );
  return `${text}\n\n${FOOTER_LABEL}\n${lines.join("\n")}`;
}

function patchSkillExpansion() {
  const prototype = AgentSession.prototype as any;
  if (prototype[PATCH_STATE]) return;

  const originalExpandSkillCommand = prototype._expandSkillCommand;
  if (typeof originalExpandSkillCommand !== "function") {
    throw new Error("AgentSession._expandSkillCommand not found");
  }

  prototype[PATCH_STATE] = true;

  prototype._expandSkillCommand = function patchedExpandSkillCommand(
    text: string,
  ) {
    try {
      const skills = this.resourceLoader?.getSkills?.().skills ?? [];
      return appendReferencedSkillPaths(text, skills);
    } catch (error) {
      console.error(
        "skill-path-references: failed to append referenced skill paths",
        error,
      );
      return text;
    }
  };
}

export default function (_pi: ExtensionAPI) {
  try {
    patchSkillExpansion();
  } catch (error) {
    console.error(
      "skill-path-references: failed to patch skill expansion",
      error,
    );
  }
}
