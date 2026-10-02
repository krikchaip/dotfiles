import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DefaultPackageManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureExtensionIntegrity,
  validExtensionIntegrity,
  validateExtensionIntegrity,
} from "../../extension-integrity.ts";

let root: string;
let packageRoot: string;
let path: string;
let manager: DefaultPackageManager;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sq-integrity-"));
  packageRoot = join(root, "package");
  path = join(packageRoot, "index.ts");
  manager = new DefaultPackageManager({
    cwd: root,
    agentDir: root,
    settingsManager: SettingsManager.inMemory(),
  });
  vi.spyOn(
    manager as unknown as { getNpmInstallPath(...args: unknown[]): string },
    "getNpmInstallPath",
  ).mockReturnValue(packageRoot);
  restore();
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

/**
 * Writes only tiny authored files, never user or installed dependency files.
 */
function restore(version = "1.0.0"): void {
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(path, "export default () => {};\n");
  writeFileSync(
    join(packageRoot, "package.json"),
    JSON.stringify({ name: "fixture", version }),
  );
}

/**
 * Captures an unpinned source at the exact version installed for the child.
 */
function capture(temporary = false) {
  return captureExtensionIntegrity(
    path,
    {
      path,
      source: "npm:fixture",
      origin: "package",
      scope: temporary ? "temporary" : "user",
      baseDir: packageRoot,
    },
    manager,
  );
}

describe("extension source integrity", () => {
  it("records the installed exact version without copying a graph", async () => {
    const record = await capture();
    expect(record.package?.exactSource).toBe("npm:fixture@1.0.0");
    const recover = vi.fn();
    await validateExtensionIntegrity([record], recover);
    expect(recover).not.toHaveBeenCalled();
    expect(validExtensionIntegrity([record], [path])).toBe(true);
  });

  it("rejects a Package version change even with identical entrypoint bytes", async () => {
    const record = await capture();
    restore("2.0.0");
    const recover = vi.fn();
    await expect(validateExtensionIntegrity([record], recover)).rejects.toThrow(
      "Package changed",
    );
    expect(recover).not.toHaveBeenCalled();
  });

  it("rejects changed direct extension bytes", async () => {
    const record = await captureExtensionIntegrity(
      path,
      {
        path,
        source: path,
        origin: "top-level",
        scope: "user",
      },
      manager,
    );
    writeFileSync(
      path,
      "export default () => { throw new Error('changed'); };\n",
    );
    await expect(validateExtensionIntegrity([record], vi.fn())).rejects.toThrow(
      "Saved extension changed",
    );
  });

  it("restores a missing temporary Package at its saved exact source", async () => {
    const record = await capture(true);
    rmSync(packageRoot, { recursive: true });
    const recover = vi.fn(async () => restore());
    await validateExtensionIntegrity([record], recover);
    expect(recover).toHaveBeenCalledExactlyOnceWith(
      "npm:fixture@1.0.0",
      path,
      packageRoot,
    );
  });

  it("validates restored bytes rather than trusting resolver success", async () => {
    const record = await capture(true);
    rmSync(packageRoot, { recursive: true });
    const recover = vi.fn(async () => restore("2.0.0"));
    await expect(validateExtensionIntegrity([record], recover)).rejects.toThrow(
      "Package changed",
    );
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it("does not reinstall a missing inherited Package", async () => {
    const record = await capture();
    rmSync(packageRoot, { recursive: true });
    const recover = vi.fn();
    await expect(validateExtensionIntegrity([record], recover)).rejects.toThrow(
      "Saved extension is missing",
    );
    expect(recover).not.toHaveBeenCalled();
  });

  it("does not overwrite a temporary Package with a missing entrypoint", async () => {
    const record = await capture(true);
    rmSync(path);
    const recover = vi.fn();
    await expect(validateExtensionIntegrity([record], recover)).rejects.toThrow(
      "Saved extension is missing",
    );
    expect(recover).not.toHaveBeenCalled();
  });

  it("does not treat a borrowed user Package as a recoverable temporary install", async () => {
    vi.mocked(
      (manager as unknown as { getNpmInstallPath(...args: unknown[]): string })
        .getNpmInstallPath,
    ).mockReturnValue(join(root, "native-temp"));
    const record = await capture(true);
    expect(record.package?.temporary).toBe(false);
  });

  it("rejects malformed or mismatched saved records", async () => {
    const record = await capture();
    expect(validExtensionIntegrity([record], ["/different.ts"])).toBe(false);
    expect(validExtensionIntegrity([record], [])).toBe(false);
    expect(
      validExtensionIntegrity([{ ...record, digest: "invalid" }], [path]),
    ).toBe(false);
    expect(
      validExtensionIntegrity(
        [{ ...record, package: { ...record.package, temporary: "yes" } }],
        [path],
      ),
    ).toBe(false);
  });
});
