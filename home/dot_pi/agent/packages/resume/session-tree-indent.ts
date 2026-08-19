/**
 * Aligns each /resume tree guide with its parent session text.
 *
 * Pi includes an invisible virtual-root gutter in every nested prefix. Remove
 * that gutter. The first connector then starts at the root session's first
 * character, and each deeper connector starts at its parent session's first
 * character.
 */
export function patchSessionTreeFirstIndent(selector: any) {
  const sessionList =
    typeof selector.getSessionList === "function"
      ? selector.getSessionList()
      : selector.sessionList;
  if (!sessionList || sessionList.__resumeFirstIndentPatched) return;

  const originalBuildTreePrefix = sessionList.buildTreePrefix;
  if (typeof originalBuildTreePrefix !== "function") return;

  sessionList.buildTreePrefix = function (this: any, node: any) {
    if (!node || node.depth === 0) return "";

    const parts = (node.ancestorContinues ?? [])
      .slice(1)
      .map((continues: boolean) => (continues ? "│  " : "   "));
    const branch = node.isLast ? "└─ " : "├─ ";
    return parts.join("") + branch;
  };

  sessionList.__resumeFirstIndentPatched = true;
}
