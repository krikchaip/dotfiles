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
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DefaultPackageManager } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";

import {
  createPiSkillSnapshot,
  discoverPiSkills,
} from "../../skill-discovery.ts";

const roots: string[] = [];

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) removeFixture(root);
});

/**
 * Creates isolated native global and project resource directories.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "side-quests-native-skills-"));
  roots.push(root);
  const agentDirectory = join(root, "agent");
  const cwd = join(root, "project");
  mkdirSync(agentDirectory);
  mkdirSync(cwd);
  return { root, agentDirectory, cwd };
}

/**
 * Writes one valid native skill with optional hidden-selection metadata.
 */
function skill(directory: string, name: string, hidden = false): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "SKILL.md");
  writeFileSync(
    path,
    [
      "---",
      `name: ${name}`,
      `description: Native ${name} skill.`,
      ...(hidden ? ["disable-model-invocation: true"] : []),
      "---",
      "Native skill instructions.",
    ].join("\n"),
  );
  return path;
}

test("uses native global, project, and .agents discovery with hidden metadata", async () => {
  const context = fixture();
  skill(join(context.agentDirectory, "skills", "sq-global"), "sq-global");
  skill(join(context.cwd, ".pi", "skills", "sq-project"), "sq-project");
  const hidden = skill(
    join(context.cwd, ".agents", "skills", "sq-hidden"),
    "sq-hidden",
    true,
  );

  const discovered = await discoverPiSkills(context);

  expect(discovered.map(({ name }) => name)).toEqual(
    expect.arrayContaining(["sq-global", "sq-project", "sq-hidden"]),
  );
  expect(discovered.find(({ name }) => name === "sq-hidden")).toMatchObject({
    disableModelInvocation: true,
    filePath: hidden,
  });
});

test("refreshes settings and package skills without executing any extension", async () => {
  const context = fixture();
  expect(
    (await discoverPiSkills(context)).some(({ name }) => name === "sq-late"),
  ).toBe(false);
  const packageDirectory = join(context.root, "late-package");
  const skillPath = skill(join(packageDirectory, "skill"), "sq-late");
  const marker = join(context.root, "extension-executed.txt");
  writeFileSync(
    join(packageDirectory, "package.json"),
    JSON.stringify({
      name: "late-skill-package",
      pi: { extensions: ["index.ts"], skills: ["skill"] },
    }),
  );
  writeFileSync(
    join(packageDirectory, "index.ts"),
    `import { writeFileSync } from "node:fs";\nexport default function () { writeFileSync(${JSON.stringify(marker)}, "executed"); }\n`,
  );
  writeFileSync(
    join(context.agentDirectory, "settings.json"),
    JSON.stringify({ packages: [packageDirectory] }),
  );

  const discovered = await discoverPiSkills(context);

  expect(discovered.find(({ name }) => name === "sq-late")?.filePath).toBe(
    skillPath,
  );
  expect(existsSync(marker)).toBe(false);
});

/**
 * Creates an authored warm npm package with a relative supporting file.
 */
function warmPackage(context: ReturnType<typeof fixture>) {
  const packageRoot = join(
    context.agentDirectory,
    "npm",
    "node_modules",
    "sq-skill-fixture",
  );
  const filePath = skill(join(packageRoot, "skills", "sq-cached"), "sq-cached");
  writeFileSync(
    join(packageRoot, "package.json"),
    JSON.stringify({
      name: "sq-skill-fixture",
      version: "1.0.0",
      pi: { skills: ["skills"] },
    }),
  );
  writeFileSync(join(dirname(filePath), "support.txt"), "Cached support v1");
  writeFileSync(
    join(context.agentDirectory, "settings.json"),
    JSON.stringify({ packages: ["npm:sq-skill-fixture@1.0.0"] }),
  );
  return { packageRoot, filePath };
}

test("online discovery reuses matching immutable warm Packages without an installer", async () => {
  vi.stubEnv("PI_OFFLINE", "0");
  const context = fixture();
  const warm = warmPackage(context);
  const commands = vi
    .spyOn(
      DefaultPackageManager.prototype as unknown as {
        runCommandCapture: (...args: unknown[]) => Promise<string>;
      },
      "runCommandCapture",
    )
    .mockRejectedValue(new Error("Unexpected Package installation"));
  const first = (await discoverPiSkills(context)).find(
    ({ name }) => name === "sq-cached",
  );
  const second = (await discoverPiSkills(context)).find(
    ({ name }) => name === "sq-cached",
  );
  expect(first).toBeDefined();
  expect(second?.filePath).toBe(first?.filePath);
  expect(commands).not.toHaveBeenCalled();
  expect(
    readdirSync(join(context.agentDirectory, "side-quests", "resources")),
  ).toHaveLength(1);
  writeFileSync(
    join(dirname(warm.filePath), "support.txt"),
    "Replacement support v2",
  );
  const third = (await discoverPiSkills(context)).find(
    ({ name }) => name === "sq-cached",
  );
  expect(third?.filePath).not.toBe(first?.filePath);
  expect(
    readFileSync(join(dirname(first?.filePath ?? ""), "support.txt"), "utf8"),
  ).toBe("Cached support v1");
});

test.each(["1", "true", "YES"])(
  "offline %s skill discovery freezes warm package resources",
  async (value) => {
    vi.stubEnv("PI_OFFLINE", value);
    const context = fixture();
    const warm = warmPackage(context);
    const cached = (await discoverPiSkills(context)).find(
      ({ name }) => name === "sq-cached",
    );
    expect(cached).toBeDefined();
    expect(cached?.filePath).not.toBe(warm.filePath);
    writeFileSync(
      join(dirname(warm.filePath), "support.txt"),
      "Replaced support v2",
    );
    expect(
      readFileSync(
        join(dirname(cached?.filePath ?? ""), "support.txt"),
        "utf8",
      ),
    ).toBe("Cached support v1");
  },
);

test("parent skill snapshot keeps package references and metadata but does not copy local skills", async () => {
  const context = fixture();
  const warm = warmPackage(context);
  const snapshot = createPiSkillSnapshot(context);
  const loaded = {
    name: "sq-cached",
    description: "Native sq-cached skill.",
    filePath: warm.filePath,
    baseDir: dirname(warm.filePath),
    disableModelInvocation: false,
    sourceInfo: {
      path: warm.filePath,
      source: "npm:sq-skill-fixture",
      scope: "user" as const,
      origin: "package" as const,
      baseDir: warm.packageRoot,
    },
  };
  const [frozen] = await snapshot([loaded]);
  writeFileSync(warm.filePath, "Replaced package skill");
  expect(readFileSync(frozen?.filePath ?? "", "utf8")).toContain(
    "Native skill instructions.",
  );
  expect(frozen?.sourceInfo.baseDir).not.toBe(warm.packageRoot);
  expect(frozen?.sourceInfo.source).toBe("npm:sq-skill-fixture");
  expect((await snapshot([loaded]))[0]?.filePath).toBe(frozen?.filePath);
  const local = {
    ...loaded,
    sourceInfo: { ...loaded.sourceInfo, source: warm.packageRoot },
  };
  expect((await snapshot([local]))[0]).toBe(local);
});

test("copied parent skill scripts execute isolated hoisted dependencies across generations", async () => {
  const context = fixture();
  const warm = warmPackage(context);
  const dependency = join(dirname(warm.packageRoot), "sq-script-dependency");
  mkdirSync(dependency);
  writeFileSync(
    join(dependency, "package.json"),
    JSON.stringify({ name: "sq-script-dependency", main: "index.cjs" }),
  );
  writeFileSync(join(dependency, "index.cjs"), 'exports.version = "1.0.0";\n');
  writeFileSync(
    join(dirname(warm.filePath), "version.cjs"),
    'module.exports = require("sq-script-dependency").version;\n',
  );
  const loaded = {
    name: "sq-cached",
    description: "Dependency skill.",
    filePath: warm.filePath,
    baseDir: dirname(warm.filePath),
    disableModelInvocation: false,
    sourceInfo: {
      path: warm.filePath,
      source: "npm:sq-skill-fixture",
      scope: "user" as const,
      origin: "package" as const,
      baseDir: warm.packageRoot,
    },
  };
  const [first] = await createPiSkillSnapshot(context)([loaded]);
  writeFileSync(join(dependency, "index.cjs"), 'exports.version = "2.0.0";\n');
  const [second] = await createPiSkillSnapshot(context)([loaded]);
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  const execute = (filePath: string) => {
    const script = join(dirname(filePath), "version.cjs");
    return createRequire(script)(script);
  };
  expect(execute(first?.filePath ?? "")).toBe("1.0.0");
  expect(execute(second?.filePath ?? "")).toBe("2.0.0");
  expect(execute(first?.filePath ?? "")).toBe("1.0.0");
});
