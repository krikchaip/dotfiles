import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";

import { capturePiParentExtensions } from "../../extension-selection.ts";

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return { ...original, cpSync: vi.fn(original.cpSync) };
});

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

test("parent startup and session replacement reuse direct package paths without copying", async () => {
  const root = mkdtempSync(join(tmpdir(), "side-quests-startup-copy-"));
  const packageRoot = join(root, "npm", "node_modules", "sq-startup-fixture");
  mkdirSync(packageRoot, { recursive: true });
  const path = join(packageRoot, "index.ts");
  writeFileSync(path, "export default () => {};\n");
  writeFileSync(
    join(packageRoot, "package.json"),
    JSON.stringify({ name: "sq-startup-fixture", version: "1.0.0" }),
  );
  const ownPath = fileURLToPath(new URL("../../index.ts", import.meta.url));
  const loaded = {
    extensions: [
      { resolvedPath: ownPath },
      {
        resolvedPath: path,
        tools: new Map(),
        sourceInfo: {
          path,
          source: "npm:sq-startup-fixture@1.0.0",
          scope: "user",
          origin: "package",
          baseDir: packageRoot,
        },
      },
    ],
  } as unknown as ReturnType<DefaultResourceLoader["getExtensions"]>;
  const nativeGetter = DefaultResourceLoader.prototype.getExtensions;
  const getter = vi
    .spyOn(DefaultResourceLoader.prototype, "getExtensions")
    .mockReturnValue(loaded);

  const captures: ReturnType<ReturnType<typeof capturePiParentExtensions>>[] =
    [];
  const consumers: ReturnType<typeof capturePiParentExtensions>[] = [];
  try {
    // Pi reads this getter when it builds the initial or replacement runtime.
    // No Agent launch or model turn has occurred at this boundary.
    for (let generation = 0; generation < 2; generation++) {
      const capture = capturePiParentExtensions({
        agentDirectory: root,
        cwd: root,
      });
      const loader = Object.create(
        DefaultResourceLoader.prototype,
      ) as DefaultResourceLoader;
      expect(loader.getExtensions()).toBe(loaded);
      consumers.push(capture);
    }
    expect(existsSync(join(root, "side-quests", "resources"))).toBe(false);
    captures.push(...consumers.map((capture) => capture()));
    expect(
      cpSync,
      "Pi startup and /resume must not copy package trees on the TUI thread.",
    ).not.toHaveBeenCalled();
    const [first, second] = await Promise.all(captures);
    expect(first?.[0]?.path).toBe(path);
    expect(second?.[0]?.path).toBe(path);
  } finally {
    await Promise.allSettled(captures);
    getter.mockRestore();
    DefaultResourceLoader.prototype.getExtensions = nativeGetter;
    vi.clearAllMocks();
    removeFixture(root);
  }
});
