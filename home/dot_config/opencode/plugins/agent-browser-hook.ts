import type { Plugin } from "@opencode-ai/plugin";

/**
 * Agent-Browser Hook Plugin
 * - Blocks forbidden flags: --profile, --session, --session-name
 * - Enforces required flag: --headed (forces true even if set to false)
 */

export const AgentBrowserHookPlugin: Plugin = async () => {
  const separators = /(\&\&|\|\||;|\|)/g;
  const targetCmd = /(^|\s)(agent-browser|agb)(?=\s|$)/;
  const ignoredSubcommands = new Set(["close", "skills", "auth"]);
  const forbiddenFlags =
    /(^|\s)--(?:profile|session|session-name)(?:=(?:"[^"]*"|'[^']*'|[^\s;&|]+)|\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+))?/g;

  const getDirectSubcommand = (segment: string) => {
    const exeMatch = segment.match(/(^|\s)(agent-browser|agb)(?=\s|$)/);
    if (!exeMatch || exeMatch.index === undefined) return null;

    const rest = segment.slice(exeMatch.index + exeMatch[0].length).trimStart();
    if (!rest) return null;

    const tokenMatch = rest.match(/^("[^"]*"|'[^']*'|[^\s;&|]+)/);
    if (!tokenMatch) return null;

    return tokenMatch[0].replace(/^['"]|['"]$/g, "").toLowerCase();
  };

  const applySegmentRules = (segment: string) => {
    if (!targetCmd.test(segment)) return { segment, changed: false };

    const subcommand = getDirectSubcommand(segment);
    if (subcommand && ignoredSubcommands.has(subcommand)) {
      return { segment, changed: false };
    }

    let next = segment;

    // Strip forbidden flags (+ optional value)
    next = next.replace(forbiddenFlags, "$1");

    // Force headed mode
    next = next.replace(
      /(^|\s)--headed=(?:false|0|no)(?=\s|$)/gi,
      "$1--headed",
    );
    next = next.replace(/(^|\s)--no-headed(?=\s|$)/g, "$1--headed");

    // Add required flag when missing
    if (!/(^|\s)--headed(?:\s|$|=)/.test(next)) {
      const trimmed = next.replace(/\s+$/, "");
      const trailing = next.slice(trimmed.length);
      next = `${trimmed} --headed${trailing}`;
    }

    return { segment: next, changed: next !== segment };
  };

  return {
    "tool.execute.before": async (input, output) => {
      const toolName = String(input?.tool ?? "").toLowerCase();
      if (toolName !== "bash" && toolName !== "shell") return;

      const args = output?.args;
      if (!args || typeof args !== "object") return;

      let command = (args as Record<string, any>).command;
      if (typeof command !== "string" || !command) return;

      if (!targetCmd.test(command)) return;

      const parts = command.split(separators);
      let modified = false;

      const rewritten = parts
        .map((part) => {
          if (part === "&&" || part === "||" || part === ";" || part === "|") {
            return part;
          }

          const result = applySegmentRules(part);
          if (result.changed) modified = true;
          return result.segment;
        })
        .join("");

      if (modified) {
        (args as Record<string, unknown>).command = rewritten;
      }
    },
  };
};
