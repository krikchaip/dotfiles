import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DefaultPackageManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";
import { PiPackageResources } from "../../package-resources.ts";

/**
 * Removes test-owned read-only graph views.
 */
function removeFixture(path: string): void {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    chmodSync(path, (stat.mode & 0o777) | 0o700);
    for (const name of readdirSync(path)) removeFixture(join(path, name));
  }
  rmSync(path, { recursive: true, force: true });
}

/**
 * Captures startup provenance without allocating immutable Package copies.
 */
test.each([false, true])(
  "startup capture allocates no graph; changed=%s fails closed",
  async (changed) => {
    const root = mkdtempSync(join(tmpdir(), "sq-lazy-capture-"));
    try {
      const pkg = join(root, "npm", "node_modules", "fixture");
      mkdirSync(pkg, { recursive: true });
      const entry = join(pkg, "index.ts");
      writeFileSync(entry, "original");
      const settings = SettingsManager.inMemory({});
      const manager = new DefaultPackageManager({
        agentDir: root,
        cwd: root,
        settingsManager: settings,
      });
      const resources = new PiPackageResources(manager, settings, root);
      const materialize = await resources.prepareFreeze(entry, {
        path: entry,
        source: "npm:fixture@1.0.0",
        scope: "user",
        origin: "package",
        baseDir: pkg,
      });
      expect(existsSync(join(root, "side-quests", "resources"))).toBe(false);
      if (changed) {
        writeFileSync(entry, "replacement");
        await expect(materialize()).rejects.toThrow(
          "changed since parent capture",
        );
        expect(existsSync(join(root, "side-quests", "resources"))).toBe(false);
      } else {
        const snapshot = await materialize();
        expect(snapshot).not.toBe(entry);
        expect(readFileSync(snapshot, "utf8")).toBe("original");
        writeFileSync(entry, "replacement");
        expect(await materialize()).toBe(snapshot);
        expect(readFileSync(snapshot, "utf8")).toBe("original");
      }
    } finally {
      removeFixture(root);
    }
  },
);
