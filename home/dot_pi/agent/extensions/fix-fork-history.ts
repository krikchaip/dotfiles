/**
 * Patches createBranchedSession to fix broken parentId references after label filtering.
 *
 * Bug: createBranchedSession filters label entries from the extracted path but does not
 * rewrite parentId of entries whose parent was a removed label. This leaves orphaned
 * subtrees with dangling parentId refs in the forked session file.
 *
 * Fix: after filtering labels, walk the remaining entries and rewire any parentId that
 * pointed to a removed label to point to that label's own parent instead (skipping
 * consecutive labels).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface SessionEntry {
  type: string;
  id: string;
  parentId: string | null;
  [key: string]: unknown;
}

interface SessionManagerInstance {
  createBranchedSession(leafId: string): string | undefined;
  getBranch(leafId: string): SessionEntry[];
}

interface SessionManagerClass {
  prototype: SessionManagerInstance;
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async () => {
    const { SessionManager } = await import("@earendil-works/pi-coding-agent");

    const proto = (SessionManager as unknown as SessionManagerClass).prototype;
    const original = proto.createBranchedSession;

    if ((original as any).__patchForkLabels) return;

    proto.createBranchedSession = function (leafId: string) {
      const result = original.call(this, leafId);

      // After original runs, this.fileEntries has been rewritten.
      // Fix any entry whose parentId points to a missing id.
      const fileEntries = (this as any).fileEntries as Array<{
        type: string;
        id?: string;
        parentId?: string | null;
      }>;
      if (!fileEntries) return result;

      const idSet = new Set<string>();
      for (const e of fileEntries) {
        if (e.id) idSet.add(e.id);
      }

      // fileEntries = [header, ...pathWithoutLabels, ...labelEntries]
      // Path portion is root-to-leaf order (linear chain).
      // Broken parentId means a label was stripped between consecutive entries.
      // Correct parent = previous entry in file order.
      let fixed = false;
      for (let i = 1; i < fileEntries.length; i++) {
        const entry = fileEntries[i];
        if (!entry.parentId) continue;
        if (idSet.has(entry.parentId)) continue;

        if (i > 1 && fileEntries[i - 1]?.id) {
          entry.parentId = fileEntries[i - 1].id!;
          fixed = true;
        }
      }

      if (fixed) {
        (this as any)._buildIndex();
        if ((this as any).flushed) {
          (this as any)._rewriteFile();
        }
      }

      return result;
    };

    (proto.createBranchedSession as any).__patchForkLabels = true;
  });
}
