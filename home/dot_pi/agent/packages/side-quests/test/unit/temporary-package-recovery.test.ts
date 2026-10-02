import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DefaultPackageManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PiPackageResources } from "../../package-resources.ts";

let root: string;
let temporaryRoot: string;
let resources: PiPackageResources;
let install: MockInstance<(parsed: unknown, scope: string) => Promise<void>>;
const source = "npm:sq-recovery-fixture@1.0.0";

beforeEach(() => {
  vi.stubEnv("PI_OFFLINE", "0");
  root = mkdtempSync(join(tmpdir(), "sq-recovery-"));
  const settings = SettingsManager.inMemory();
  const manager = new DefaultPackageManager({
    agentDir: root,
    cwd: root,
    settingsManager: settings,
  });
  const native = manager as unknown as {
    parseSource(value: string): unknown;
    getNpmInstallPath(parsed: unknown, scope: "temporary"): string;
    installParsedSource(parsed: unknown, scope: string): Promise<void>;
  };
  temporaryRoot = native.getNpmInstallPath(
    native.parseSource(source),
    "temporary",
  );
  install = vi
    .spyOn(native, "installParsedSource")
    .mockImplementation(async () => {
      mkdirSync(temporaryRoot, { recursive: true });
      writeFileSync(
        join(temporaryRoot, "package.json"),
        JSON.stringify({ name: "sq-recovery-fixture", version: "1.0.0" }),
      );
    });
  resources = new PiPackageResources(manager, settings, root, false);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("native temporary Package recovery", () => {
  it("restores the saved native-temp path even with a matching warm user install", async () => {
    const user = join(root, "npm", "node_modules", "sq-recovery-fixture");
    mkdirSync(user, { recursive: true });
    writeFileSync(
      join(user, "package.json"),
      JSON.stringify({ name: "sq-recovery-fixture", version: "1.0.0" }),
    );
    await resources.restoreTemporary(source, temporaryRoot);
    expect(install).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        type: "npm",
        spec: "sq-recovery-fixture@1.0.0",
      }),
      "temporary",
    );
    expect(existsSync(join(temporaryRoot, "package.json"))).toBe(true);
    expect(
      existsSync(join(root, "side-quests", "temporary-install.lock")),
    ).toBe(false);
  });

  it("rejects an unexpected saved root before commands", async () => {
    await expect(
      resources.restoreTemporary(source, join(root, "foreign")),
    ).rejects.toThrow("different native-temp root");
    expect(install).not.toHaveBeenCalled();
  });

  it.each(["npm:sq-recovery-fixture", "./local"])(
    "rejects non-exact source %s",
    async (value) => {
      await expect(
        resources.restoreTemporary(value, temporaryRoot),
      ).rejects.toThrow("exact remote source");
      expect(install).not.toHaveBeenCalled();
    },
  );

  it("does not replace a dangling symlink", async () => {
    mkdirSync(join(temporaryRoot, ".."), { recursive: true });
    symlinkSync(join(root, "missing-target"), temporaryRoot, "dir");
    await expect(
      resources.restoreTemporary(source, temporaryRoot),
    ).rejects.toThrow("existing Package");
    expect(install).not.toHaveBeenCalled();
  });

  it("refuses offline recovery before commands", async () => {
    vi.stubEnv("PI_OFFLINE", "1");
    await expect(
      resources.restoreTemporary(source, temporaryRoot),
    ).rejects.toThrow("Offline saved extension recovery");
    expect(install).not.toHaveBeenCalled();
  });

  it("checks the allocation guard before commands and releases its lock on refusal", async () => {
    vi.stubEnv("PI_SIDE_QUESTS_MAX_RESOURCE_BYTES", "1");
    const stored = join(root, "side-quests", "resources");
    mkdirSync(stored, { recursive: true });
    writeFileSync(join(stored, "authored-fixture"), "exceeds test cap");
    await expect(
      resources.restoreTemporary(source, temporaryRoot),
    ).rejects.toThrow("resource budget");
    expect(install).not.toHaveBeenCalled();
    expect(
      existsSync(join(root, "side-quests", "temporary-install.lock")),
    ).toBe(false);
  });

  it("does not overwrite the Package restored by another concurrent request", async () => {
    const results = await Promise.allSettled([
      resources.restoreTemporary(source, temporaryRoot),
      resources.restoreTemporary(source, temporaryRoot),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("releases the install lock after native failure", async () => {
    install.mockRejectedValueOnce(new Error("native fixture failure"));
    await expect(
      resources.restoreTemporary(source, temporaryRoot),
    ).rejects.toThrow("native fixture failure");
    expect(
      existsSync(join(root, "side-quests", "temporary-install.lock")),
    ).toBe(false);
    await resources.restoreTemporary(source, temporaryRoot);
    expect(install).toHaveBeenCalledTimes(2);
  });
});
