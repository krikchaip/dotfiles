import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

import type { ConfiguredCapability } from "../../agent-definitions.ts";
import {
  type ExtensionDiscovery,
  ExtensionSelection,
  type ResolvedExtension,
  createPiExtensionDiscovery,
} from "../../extension-selection.ts";

const sourcePath = "/project/.pi/agents/reviewer.md";

function capability(
  selection: ConfiguredCapability["selection"],
): ConfiguredCapability {
  return { selection, sourcePath };
}

function extension(
  source: string,
  path: string,
  origin: "direct" | "package" = "package",
): ResolvedExtension {
  return {
    identity: source.replace(/@[^@]+$/, ""),
    origin,
    path,
    providerPath: path,
    providedTools: [],
    source,
  };
}

function discovery(options: {
  explicit?: Record<string, readonly ResolvedExtension[]>;
  normal: readonly ResolvedExtension[];
}): ExtensionDiscovery {
  return {
    explicit: async (sources, baseDirectory) =>
      sources.flatMap(
        (source) =>
          options.explicit?.[`${baseDirectory}:${source}`] ??
          options.explicit?.[source] ??
          [],
      ),
    normal: async () => options.normal,
    direct: async () =>
      options.normal.filter(({ origin }) => origin === "direct"),
  };
}

test("inherits the complete parent snapshot only when extensions are omitted", async () => {
  const inherited = [
    extension("cli", "/cli.ts", "direct"),
    extension("npm:parent@1", "/parent.ts"),
  ];
  const resolver = new ExtensionSelection(
    discovery({ normal: [extension("local", "/fresh.ts", "direct")] }),
  );

  await expect(resolver.resolve(undefined, inherited)).resolves.toEqual(
    inherited,
  );
  await expect(
    resolver.resolve(capability({ kind: "none" }), inherited),
  ).resolves.toEqual([extension("local", "/fresh.ts", "direct")]);
});

test("uses fresh normal discovery for broad all and a Direct baseline for fixed selection", async () => {
  const direct = extension("local", "/fresh.ts", "direct");
  const configured = extension("npm:configured@1", "/configured.ts");
  const chosen = extension("npm:chosen@2", "/chosen.ts");
  const resolver = new ExtensionSelection(
    discovery({
      normal: [direct, configured],
      explicit: { "npm:chosen@2": [chosen] },
    }),
  );

  await expect(
    resolver.resolve(capability({ kind: "all" }), []),
  ).resolves.toEqual([direct, configured]);
  await expect(
    resolver.resolve(
      capability({
        kind: "fixed",
        entries: [{ kind: "include", name: "npm:chosen@2" }],
      }),
      [],
    ),
  ).resolves.toEqual([direct, chosen]);
});

test("upserts a parent-relative exact version by Pi identity", async () => {
  const resolver = new ExtensionSelection(
    discovery({
      normal: [],
      explicit: {
        "npm:example@2": [extension("npm:example@2", "/example-2.ts")],
        "npm:other": [extension("npm:other@1", "/other.ts")],
      },
    }),
  );

  await expect(
    resolver.resolve(
      capability({
        kind: "parent-relative",
        entries: [
          { kind: "include", name: "npm:example@2" },
          { kind: "exclude", name: "npm:other" },
        ],
      }),
      [
        extension("npm:example@1", "/example-1.ts"),
        extension("npm:other@1", "/other.ts"),
      ],
    ),
  ).resolves.toEqual([extension("npm:example@2", "/example-2.ts")]);
});

test("resolves an explicit local source from its field source directory", async () => {
  const local = extension(
    "/project/.pi/extension.ts",
    "/extension.ts",
    "direct",
  );
  const resolver = new ExtensionSelection(
    discovery({
      normal: [],
      explicit: { "/project/.pi:./extension.ts": [local] },
    }),
  );

  await expect(
    resolver.resolve(
      capability({
        kind: "fixed",
        entries: [{ kind: "include", name: "./extension.ts" }],
      }),
      [],
    ),
  ).resolves.toEqual([local]);
});

test("rejects unmatched explicit additions and removals", async () => {
  const resolver = new ExtensionSelection(discovery({ normal: [] }));

  await expect(
    resolver.resolve(
      capability({
        kind: "fixed",
        entries: [{ kind: "include", name: "npm:empty" }],
      }),
      [],
    ),
  ).rejects.toThrow("npm:empty did not resolve to an extension entrypoint");
  await expect(
    resolver.resolve(
      capability({
        kind: "parent-relative",
        entries: [{ kind: "exclude", name: "npm:missing" }],
      }),
      [extension("npm:other@1", "/other.ts")],
    ),
  ).rejects.toThrow("npm:missing did not resolve to an extension entrypoint");
});

test("uses the installed Pi package resolver and identity contract", async () => {
  const root = mkdtempSync(join(tmpdir(), "side-quests-pi-resolver-"));
  const extensionPath = join(root, "fixture.ts");
  writeFileSync(extensionPath, "export default () => {};\n");

  try {
    const resolved = await createPiExtensionDiscovery({
      agentDirectory: root,
      cwd: root,
    }).explicit([extensionPath], root);

    expect(resolved).toMatchObject([
      {
        identity: expect.any(String),
        path: extensionPath,
        source: extensionPath,
      },
    ]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("canonical local aliases reject duplicate selections and match inherited removals", async () => {
  const root = mkdtempSync(join(tmpdir(), "side-quests-canonical-alias-"));
  const scope = join(root, ".pi");
  const directory = join(scope, "fixture");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "selected.ts"), "export default () => {};\n");
  symlinkSync(directory, join(scope, "alias"), "dir");
  try {
    const adapter = createPiExtensionDiscovery({
      agentDirectory: root,
      cwd: root,
    });
    const resolver = new ExtensionSelection(adapter);
    await expect(
      resolver.resolve(
        {
          sourcePath: join(scope, "agents", "reviewer.md"),
          selection: {
            kind: "fixed",
            entries: [
              { kind: "include", name: "./fixture/selected.ts" },
              { kind: "include", name: "./alias/selected.ts" },
            ],
          },
        },
        [],
      ),
    ).rejects.toThrow("repeats Pi identity");
    const snapshot = await adapter.explicit(
      [join(directory, "selected.ts")],
      scope,
    );
    await expect(
      resolver.resolve(
        {
          sourcePath: join(scope, "agents", "reviewer.md"),
          selection: {
            kind: "parent-relative",
            entries: [{ kind: "exclude", name: "./alias/selected.ts" }],
          },
        },
        snapshot,
      ),
    ).resolves.toEqual([]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("rejects two requested sources with one Pi-normalized identity", async () => {
  const resolver = new ExtensionSelection(
    discovery({
      normal: [],
      explicit: {
        "npm:example@1": [extension("npm:example@1", "/example-1.ts")],
        "npm:example@2": [extension("npm:example@2", "/example-2.ts")],
      },
    }),
  );

  await expect(
    resolver.resolve(
      capability({
        kind: "fixed",
        entries: [
          { kind: "include", name: "npm:example@1" },
          { kind: "include", name: "npm:example@2" },
        ],
      }),
      [],
    ),
  ).rejects.toThrow("repeats Pi identity npm:example");
});

test.each(["global", "project"] as const)(
  "removes exactly one auto-discovered %s Direct baseline member by its path",
  async (scope) => {
    const root = mkdtempSync(join(tmpdir(), "side-quests-direct-removal-"));
    const agentDirectory = join(root, "agent");
    const definitionDirectory =
      scope === "global" ? agentDirectory : join(root, ".pi");
    const extensionsDirectory = join(definitionDirectory, "extensions");
    mkdirSync(extensionsDirectory, { recursive: true });
    const removed = join(extensionsDirectory, "removed.ts");
    const retained = join(extensionsDirectory, "retained.ts");
    writeFileSync(removed, "export default () => {};\n");
    writeFileSync(retained, "export default () => {};\n");

    try {
      const adapter = createPiExtensionDiscovery({ agentDirectory, cwd: root });
      const parentSnapshot = await adapter.normal();
      expect(parentSnapshot.map(({ path }) => path)).toEqual([
        removed,
        retained,
      ]);
      const resolver = new ExtensionSelection(adapter);
      const selected = await resolver.resolve(
        {
          sourcePath: join(definitionDirectory, "agents", "reviewer.md"),
          selection: {
            kind: "parent-relative",
            entries: [{ kind: "exclude", name: "./extensions/removed.ts" }],
          },
        },
        parentSnapshot,
      );
      expect(selected.map(({ path }) => path)).toEqual([retained]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  },
);

test.each(["global", "project"] as const)(
  "manifest-directory removal in %s scope matches Direct entrypoints and retains undeclared peers",
  async (scope) => {
    const root = mkdtempSync(join(tmpdir(), "side-quests-direct-manifest-"));
    const agentDirectory = join(root, "agent");
    const definitionDirectory =
      scope === "global" ? agentDirectory : join(root, ".pi");
    const extensionsDirectory = join(definitionDirectory, "extensions");
    mkdirSync(extensionsDirectory, { recursive: true });
    const removed = join(extensionsDirectory, "removed.ts");
    const retained = join(extensionsDirectory, "retained.ts");
    writeFileSync(removed, "export default () => {};\n");
    writeFileSync(retained, "export default () => {};\n");
    writeFileSync(
      join(extensionsDirectory, "package.json"),
      JSON.stringify({
        name: "direct-manifest-fixture",
        pi: { extensions: ["removed.ts"] },
      }),
    );
    // Load the undeclared peer explicitly, as native automatic discovery respects the manifest.
    writeFileSync(
      join(definitionDirectory, "settings.json"),
      JSON.stringify({ extensions: [retained] }),
    );
    symlinkSync(extensionsDirectory, join(definitionDirectory, "alias"), "dir");
    try {
      const adapter = createPiExtensionDiscovery({ agentDirectory, cwd: root });
      const parentSnapshot = await adapter.normal();
      expect(parentSnapshot.map(({ path }) => path).sort()).toEqual([
        removed,
        retained,
      ]);
      const declared = await adapter.explicit(
        ["./extensions"],
        definitionDirectory,
      );
      expect(declared.map(({ path }) => path)).toEqual([removed]);
      expect(declared[0]?.origin).toBe("package");
      const resolver = new ExtensionSelection(adapter);
      for (const name of ["./extensions", "./alias"]) {
        const selected = await resolver.resolve(
          {
            sourcePath: join(definitionDirectory, "agents", "reviewer.md"),
            selection: {
              kind: "parent-relative",
              entries: [{ kind: "exclude", name }],
            },
          },
          parentSnapshot,
        );
        expect(selected.map(({ path }) => path)).toEqual([retained]);
      }
      await expect(
        resolver.resolve(
          {
            sourcePath: join(definitionDirectory, "agents", "reviewer.md"),
            selection: {
              kind: "parent-relative",
              entries: [{ kind: "exclude", name: "./extensions" }],
            },
          },
          parentSnapshot.filter(({ path }) => path === retained),
        ),
      ).rejects.toThrow("does not match the parent set");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  },
);

test.each(["global", "project"] as const)(
  "fresh Pi discovery reloads changed %s extension settings",
  async (scope) => {
    const root = mkdtempSync(join(tmpdir(), "side-quests-fresh-settings-"));
    const agentDirectory = join(root, "agent");
    const projectDirectory = join(root, ".pi");
    mkdirSync(agentDirectory);
    mkdirSync(projectDirectory);
    const first = join(root, "first.ts");
    const second = join(root, "second.ts");
    writeFileSync(first, "export default () => {};\n");
    writeFileSync(second, "export default () => {};\n");
    const settingsPath = join(
      scope === "global" ? agentDirectory : projectDirectory,
      "settings.json",
    );
    writeFileSync(settingsPath, JSON.stringify({ extensions: [first] }));

    try {
      const adapter = createPiExtensionDiscovery({ agentDirectory, cwd: root });
      expect((await adapter.normal()).map(({ path }) => path)).toEqual([first]);
      writeFileSync(settingsPath, JSON.stringify({ extensions: [second] }));
      expect((await adapter.normal()).map(({ path }) => path)).toEqual([
        second,
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  },
);

test.each(["global", "project"] as const)(
  "offline %s selection resolves only the requested surface and retains native Direct settings",
  async (scope) => {
    vi.stubEnv("PI_OFFLINE", "1");
    const root = mkdtempSync(join(tmpdir(), "side-quests-offline-selection-"));
    const agentDirectory = join(root, "agent");
    const directory = scope === "global" ? agentDirectory : join(root, ".pi");
    const extensions = join(directory, "extensions");
    mkdirSync(extensions, { recursive: true });
    const local = join(extensions, "local.ts");
    const blocked = join(extensions, "blocked.ts");
    const configured = join(directory, "configured.ts");
    for (const path of [local, blocked, configured])
      writeFileSync(path, "export default () => {};\n");
    const settingsPath = join(directory, "settings.json");
    const missing = "npm:side-quests-uncached-fixture@1.0.0";
    writeFileSync(
      settingsPath,
      JSON.stringify({
        packages: [missing],
        extensions: ["./configured.ts", "!extensions/blocked.ts"],
      }),
    );
    try {
      const adapter = createPiExtensionDiscovery({ agentDirectory, cwd: root });
      const resolver = new ExtensionSelection(adapter);
      const snapshot = await adapter.explicit([local], directory);
      const resolve = (selection: ConfiguredCapability["selection"]) =>
        resolver.resolve(
          { selection, sourcePath: join(directory, "agents", "reviewer.md") },
          snapshot,
        );
      for (const selection of [
        { kind: "none" },
        {
          kind: "fixed",
          entries: [{ kind: "include", name: "./extensions/local.ts" }],
        },
      ] as const) {
        expect(
          (await resolve(selection)).map(({ path }) => path).sort(),
        ).toEqual([local, configured].sort());
      }
      expect(
        (
          await resolve({
            kind: "parent-relative",
            entries: [{ kind: "include", name: "./extensions/local.ts" }],
          })
        ).map(({ path }) => path),
      ).toEqual([local]);
      expect(
        await resolve({
          kind: "parent-relative",
          entries: [{ kind: "exclude", name: "./extensions/local.ts" }],
        }),
      ).toEqual([]);
      for (const selection of [
        { kind: "all" },
        { kind: "fixed", entries: [{ kind: "include", name: missing }] },
        {
          kind: "parent-relative",
          entries: [{ kind: "include", name: missing }],
        },
      ] as const) {
        await expect(resolve(selection)).rejects.toThrow(
          "has no matching installed resources",
        );
      }
      // A new Direct-only child must still reread settings without resolving packages.
      writeFileSync(settingsPath, JSON.stringify({ packages: [missing] }));
      expect(
        (await resolve({ kind: "none" })).map(({ path }) => path).sort(),
      ).toEqual([local, blocked].sort());
    } finally {
      vi.unstubAllEnvs();
      rmSync(root, { force: true, recursive: true });
    }
  },
);
