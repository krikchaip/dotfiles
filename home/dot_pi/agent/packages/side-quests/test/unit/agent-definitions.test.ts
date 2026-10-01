import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";

import { AgentDefinitions } from "../../agent-definitions.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { force: true, recursive: true });
});

function fixture(): { agentDirectory: string; cwd: string } {
  const root = mkdtempSync(join(tmpdir(), "side-quests-agents-"));
  directories.push(root);
  const cwd = join(root, "project");
  const agentDirectory = join(root, "agent");
  return { agentDirectory, cwd };
}

function definition(directory: string, name: string, content: string): void {
  writeFileSync(join(directory, `${name}.md`), content, {
    encoding: "utf8",
    flag: "w",
  });
}

test("project definitions overlay global definitions and produce the parent catalog", () => {
  const { agentDirectory, cwd } = fixture();
  const project = join(cwd, ".pi", "agents");
  const global = join(agentDirectory, "agents");
  mkdirSync(project, { recursive: true });
  mkdirSync(global, { recursive: true });

  definition(
    project,
    "security",
    "---\ndescription: Review project permission boundaries\n---\n",
  );
  definition(
    global,
    "security",
    "---\ndescription: Global security review\n---\n",
  );
  definition(
    global,
    "accessibility",
    "---\ndescription: Review accessibility defects\n---\n",
  );
  definition(
    global,
    "general-purpose",
    "---\ndescription: Handle ordinary project delegation\n---\n",
  );

  const definitions = AgentDefinitions.resolve({ agentDirectory, cwd });

  expect(definitions.names()).toEqual([
    "general-purpose",
    "accessibility",
    "security",
  ]);
  expect(definitions.guidelines()).toEqual([
    "When a side quest matches a specialized sub-agent below, delegate that side quest directly to that sub-agent.",
    "Subagent accessibility. Review accessibility defects",
    "Subagent security. Review project permission boundaries",
    "Subagent general-purpose. Handle ordinary project delegation",
  ]);
});

test("uses one canonical mixed-case order for enum and catalog", () => {
  const { agentDirectory, cwd } = fixture();
  const project = join(cwd, ".pi", "agents");
  mkdirSync(project, { recursive: true });
  definition(project, "B", "---\ndescription: Uppercase\n---\n");
  definition(project, "a", "---\ndescription: Lowercase\n---\n");

  const definitions = AgentDefinitions.resolve({ agentDirectory, cwd });

  expect(definitions.names()).toEqual(["general-purpose", "B", "a"]);
  expect(definitions.guidelines().slice(1)).toEqual([
    "Subagent B. Uppercase",
    "Subagent a. Lowercase",
  ]);
});

test("parses normalized supported frontmatter and preserves agent instructions", () => {
  const { agentDirectory, cwd } = fixture();
  const project = join(cwd, ".pi", "agents");
  mkdirSync(project, { recursive: true });

  definition(
    project,
    "reviewer",
    [
      "---",
      "description:  Review   implementation   evidence  ",
      "display_name:  Evidence   reviewer  ",
      "model: openai-codex/gpt-5.6",
      "thinking: high",
      "tools: read, grep",
      "extensions: true",
      "skills: research, ++tdd",
      "disallowed_tools: [42]",
      "disallowed_extensions: 42",
      "available_skills: 42",
      "preload_skills: true",
      "inherit_context: false",
      "interactive: true",
      "---",
      "",
      "  Keep this internal Markdown spacing.  ",
    ].join("\n"),
  );

  const agentDefinition = AgentDefinitions.resolve({
    agentDirectory,
    cwd,
  }).get("reviewer");

  expect(agentDefinition).toMatchObject({
    description: "Review implementation evidence",
    displayName: "Evidence reviewer",
    model: "openai-codex/gpt-5.6",
    thinking: "high",
    tools: {
      sourcePath: join(project, "reviewer.md"),
      selection: {
        kind: "fixed",
        entries: [
          { kind: "include", name: "read" },
          { kind: "include", name: "grep" },
        ],
      },
    },
    extensions: {
      sourcePath: join(project, "reviewer.md"),
      selection: { kind: "all" },
    },
    skills: {
      sourcePath: join(project, "reviewer.md"),
      selection: {
        kind: "fixed",
        entries: [
          { kind: "include", name: "research" },
          { kind: "preload", name: "tdd" },
        ],
      },
    },
    inheritContext: false,
    interactive: true,
    body: "Keep this internal Markdown spacing.",
  });
});

test("accepts exact empty general-purpose frontmatter as a no-op", () => {
  const { agentDirectory, cwd } = fixture();
  const project = join(cwd, ".pi", "agents");
  mkdirSync(project, { recursive: true });
  definition(project, "general-purpose", "---\n---");

  const agent = AgentDefinitions.resolve({ agentDirectory, cwd }).get(
    "general-purpose",
  );

  expect(agent).toMatchObject({
    name: "general-purpose",
    displayName: "general-purpose",
    body: undefined,
  });
});

test.each(["/model", "provider/"])(
  "rejects model with an empty provider or model-id: %s",
  (model) => {
    const { agentDirectory, cwd } = fixture();
    const project = join(cwd, ".pi", "agents");
    mkdirSync(project, { recursive: true });
    definition(
      project,
      "security",
      `---\ndescription: Review security\nmodel: ${model}\n---\n`,
    );

    const definitions = AgentDefinitions.resolve({ agentDirectory, cwd });

    expect(definitions.get("security")).toBeUndefined();
    expect(definitions.diagnostic("security")?.reason).toBe(
      "model must be an exact provider/model-id pair",
    );
  },
);

test.each([
  "description: null",
  "display_name: null",
  "enabled: null",
  "model: null",
  "thinking: null",
  "tools: null",
  "extensions: null",
  "skills: null",
  "inherit_context: null",
  "interactive: null",
  "display_name: ''",
  "model: ''",
  "thinking: ''",
  "tools: ''",
  "extensions: ''",
  "skills: ''",
  "display_name: 42",
  "enabled: 'false'",
  "model: true",
  "thinking: true",
  "tools: 42",
  "extensions: 42",
  "skills: 42",
  "inherit_context: 'false'",
  "interactive: 'true'",
] as const)("rejects present invalid frontmatter value %s", (line) => {
  const { agentDirectory, cwd } = fixture();
  const project = join(cwd, ".pi", "agents");
  mkdirSync(project, { recursive: true });
  definition(
    project,
    "security",
    `---\ndescription: Review security\n${line}\n---\n`,
  );

  expect(
    AgentDefinitions.resolve({ agentDirectory, cwd }).get("security"),
  ).toBeUndefined();
});

test("accepts every explicit empty collection", () => {
  const { agentDirectory, cwd } = fixture();
  const project = join(cwd, ".pi", "agents");
  mkdirSync(project, { recursive: true });
  definition(
    project,
    "security",
    "---\ndescription: Review security\ntools: []\nextensions: []\nskills: []\n---\n",
  );

  expect(
    AgentDefinitions.resolve({ agentDirectory, cwd }).get("security"),
  ).toMatchObject({
    tools: { selection: { kind: "none" } },
    extensions: { selection: { kind: "none" } },
    skills: { selection: { kind: "none" } },
  });
});

test("a malformed project layer invalidates its valid global layer", () => {
  const { agentDirectory, cwd } = fixture();
  const project = join(cwd, ".pi", "agents");
  const global = join(agentDirectory, "agents");
  mkdirSync(project, { recursive: true });
  mkdirSync(global, { recursive: true });
  definition(
    global,
    "security",
    "---\ndescription: Global security review\n---\n",
  );
  definition(project, "security", "---\ndescription: 42\n---\n");

  const definitions = AgentDefinitions.resolve({ agentDirectory, cwd });

  expect(definitions.get("security")).toBeUndefined();
  expect(definitions.names()).toEqual(["general-purpose"]);
  expect(definitions.diagnostic("security")?.path).toBe(
    join(project, "security.md"),
  );
});

test("disabled tombstones validate sibling fields and suppress named agents", () => {
  const { agentDirectory, cwd } = fixture();
  const project = join(cwd, ".pi", "agents");
  const global = join(agentDirectory, "agents");
  mkdirSync(project, { recursive: true });
  mkdirSync(global, { recursive: true });
  definition(
    global,
    "security",
    "---\ndescription: Global security review\n---\n",
  );
  definition(project, "security", "---\nenabled: false\ntools: [42]\n---\n");

  const definitions = AgentDefinitions.resolve({ agentDirectory, cwd });

  expect(definitions.get("security")).toBeUndefined();
  expect(definitions.diagnostic("security")?.path).toBe(
    join(project, "security.md"),
  );
  expect(definitions.names()).toEqual(["general-purpose"]);
});

test("agent-overlay-replaces-collection-fields", () => {
  const { agentDirectory, cwd } = fixture();
  const project = join(cwd, ".pi", "agents");
  const global = join(agentDirectory, "agents");
  mkdirSync(project, { recursive: true });
  mkdirSync(global, { recursive: true });
  definition(
    global,
    "security",
    [
      "---",
      "description: Global security review",
      "tools: [read, grep]",
      "extensions: [npm:global-extension]",
      "skills: [research, ++tdd]",
      "---",
    ].join("\n"),
  );
  definition(
    project,
    "security",
    ["---", "tools: [bash]", "extensions: []", "skills: [++tdd]", "---"].join(
      "\n",
    ),
  );

  expect(
    AgentDefinitions.resolve({ agentDirectory, cwd }).get("security"),
  ).toMatchObject({
    description: "Global security review",
    tools: {
      selection: {
        kind: "fixed",
        entries: [{ kind: "include", name: "bash" }],
      },
    },
    extensions: { selection: { kind: "none" } },
    skills: {
      selection: { kind: "fixed", entries: [{ kind: "preload", name: "tdd" }] },
    },
  });
});

test("agent-overlay-inherits-global-body", () => {
  const { agentDirectory, cwd } = fixture();
  const project = join(cwd, ".pi", "agents");
  const global = join(agentDirectory, "agents");
  mkdirSync(project, { recursive: true });
  mkdirSync(global, { recursive: true });
  definition(
    global,
    "security",
    "---\ndescription: Global security review\n---\nGlobal body",
  );
  definition(project, "security", "---\n---\n \n\t ");

  expect(
    AgentDefinitions.resolve({ agentDirectory, cwd }).get("security")?.body,
  ).toBe("Global body");

  definition(project, "security", "---\n---\nProject body");

  expect(
    AgentDefinitions.resolve({ agentDirectory, cwd }).get("security")?.body,
  ).toBe("Project body");
});

test("agent-overlay-rejects-overridden-invalid-global", () => {
  const { agentDirectory, cwd } = fixture();
  const project = join(cwd, ".pi", "agents");
  const global = join(agentDirectory, "agents");
  mkdirSync(project, { recursive: true });
  mkdirSync(global, { recursive: true });
  definition(global, "security", "---\ndescription: 42\n---\n");
  definition(
    project,
    "security",
    "---\ndescription: Valid project description\n---\n",
  );

  const definitions = AgentDefinitions.resolve({ agentDirectory, cwd });

  expect(definitions.get("security")).toBeUndefined();
  expect(definitions.diagnostic("security")?.path).toBe(
    join(global, "security.md"),
  );
});

test("agent-overlay-project-enabled-overrides-global", () => {
  const { agentDirectory, cwd } = fixture();
  const project = join(cwd, ".pi", "agents");
  const global = join(agentDirectory, "agents");
  mkdirSync(project, { recursive: true });
  mkdirSync(global, { recursive: true });
  definition(
    global,
    "security",
    "---\ndescription: Global security review\nenabled: false\n---\n",
  );
  definition(project, "security", "---\nenabled: true\n---\n");
  expect(
    AgentDefinitions.resolve({ agentDirectory, cwd }).get("security"),
  ).toMatchObject({ description: "Global security review" });

  definition(
    global,
    "security",
    "---\ndescription: Global security review\nenabled: true\n---\n",
  );
  definition(project, "security", "---\nenabled: false\n---\n");
  expect(
    AgentDefinitions.resolve({ agentDirectory, cwd }).get("security"),
  ).toBeUndefined();

  definition(
    global,
    "security",
    "---\ndescription: Global security review\nenabled: false\n---\n",
  );
  definition(
    project,
    "security",
    "---\ndescription: Project security review\n---\n",
  );
  expect(
    AgentDefinitions.resolve({ agentDirectory, cwd }).get("security"),
  ).toBeUndefined();
});

test("agent-overlay-validates-description-after-overlay", () => {
  const { agentDirectory, cwd } = fixture();
  const project = join(cwd, ".pi", "agents");
  const global = join(agentDirectory, "agents");
  mkdirSync(project, { recursive: true });
  definition(project, "security", "---\nmodel: openai/gpt-5.6\n---\n");

  expect(
    AgentDefinitions.resolve({ agentDirectory, cwd }).diagnostic("security")
      ?.reason,
  ).toBe("named definitions require a non-empty description");

  mkdirSync(global, { recursive: true });
  definition(
    global,
    "security",
    "---\ndescription: Global security review\n---\n",
  );
  expect(
    AgentDefinitions.resolve({ agentDirectory, cwd }).get("security"),
  ).toMatchObject({
    description: "Global security review",
    model: "openai/gpt-5.6",
  });
});

test("agent-overlay-uses-parent-default-after-double-omission", () => {
  const { agentDirectory, cwd } = fixture();
  const project = join(cwd, ".pi", "agents");
  const global = join(agentDirectory, "agents");
  mkdirSync(project, { recursive: true });
  mkdirSync(global, { recursive: true });
  definition(
    global,
    "security",
    "---\ndescription: Global security review\n---\n",
  );
  definition(project, "security", "---\n---\n");

  expect(
    AgentDefinitions.resolve({ agentDirectory, cwd }).get("security"),
  ).toMatchObject({
    model: undefined,
    thinking: undefined,
    tools: undefined,
    extensions: undefined,
    skills: undefined,
    inheritContext: undefined,
    interactive: undefined,
  });
});

test("agent-overlay-restored-agent-inherits-global-fields", () => {
  const { agentDirectory, cwd } = fixture();
  const project = join(cwd, ".pi", "agents");
  const global = join(agentDirectory, "agents");
  mkdirSync(project, { recursive: true });
  mkdirSync(global, { recursive: true });
  definition(
    global,
    "security",
    [
      "---",
      "description: Global security review",
      "display_name: Global reviewer",
      "enabled: false",
      "tools: [read]",
      "skills: [research]",
      "---",
      "Global body",
    ].join("\n"),
  );
  definition(project, "security", "---\nenabled: true\n---\n");

  expect(
    AgentDefinitions.resolve({ agentDirectory, cwd }).get("security"),
  ).toMatchObject({
    description: "Global security review",
    displayName: "Global reviewer",
    tools: {
      selection: {
        kind: "fixed",
        entries: [{ kind: "include", name: "read" }],
      },
    },
    skills: {
      selection: {
        kind: "fixed",
        entries: [{ kind: "include", name: "research" }],
      },
    },
    body: "Global body",
  });
});

test("agent-overlay-tombstone-validates-global", () => {
  const { agentDirectory, cwd } = fixture();
  const project = join(cwd, ".pi", "agents");
  const global = join(agentDirectory, "agents");
  mkdirSync(project, { recursive: true });
  mkdirSync(global, { recursive: true });
  definition(global, "security", "---\ntools: [42]\n---\n");
  definition(project, "security", "---\nenabled: false\n---\n");

  const definitions = AgentDefinitions.resolve({ agentDirectory, cwd });

  expect(definitions.get("security")).toBeUndefined();
  expect(definitions.diagnostic("security")?.path).toBe(
    join(global, "security.md"),
  );
});

test("agent-overlay-validates-disabled-layer-fields", () => {
  const { agentDirectory, cwd } = fixture();
  const project = join(cwd, ".pi", "agents");
  const global = join(agentDirectory, "agents");
  mkdirSync(project, { recursive: true });
  mkdirSync(global, { recursive: true });
  definition(global, "security", "---\nenabled: false\ntools: [42]\n---\n");
  definition(project, "security", "---\nenabled: true\n---\n");
  expect(
    AgentDefinitions.resolve({ agentDirectory, cwd }).diagnostic("security")
      ?.path,
  ).toBe(join(global, "security.md"));

  definition(
    global,
    "security",
    "---\ndescription: Global security review\n---\n",
  );
  definition(project, "security", "---\nenabled: false\ntools: [42]\n---\n");
  expect(
    AgentDefinitions.resolve({ agentDirectory, cwd }).diagnostic("security")
      ?.path,
  ).toBe(join(project, "security.md"));
});

const MATRIX_IDENTITIES = ["general-purpose", "security"] as const;
type MatrixIdentity = (typeof MATRIX_IDENTITIES)[number];

type MatrixField = Readonly<{
  key:
    | "description"
    | "display_name"
    | "enabled"
    | "model"
    | "thinking"
    | "inherit_context"
    | "interactive";
  output?: string;
  valid: string;
  value: unknown;
  wrong: string;
}>;

const FRONTMATTER_FIELD_MATRIX: readonly MatrixField[] = [
  {
    key: "description",
    output: "description",
    valid: "Role selection description",
    value: "Role selection description",
    wrong: "42",
  },
  {
    key: "display_name",
    output: "displayName",
    valid: "Friendly reviewer",
    value: "Friendly reviewer",
    wrong: "42",
  },
  { key: "enabled", valid: "true", value: true, wrong: "42" },
  {
    key: "model",
    output: "model",
    valid: "openai/gpt-5.6",
    value: "openai/gpt-5.6",
    wrong: "true",
  },
  {
    key: "thinking",
    output: "thinking",
    valid: "high",
    value: "high",
    wrong: "true",
  },
  {
    key: "inherit_context",
    output: "inheritContext",
    valid: "false",
    value: false,
    wrong: "'false'",
  },
  {
    key: "interactive",
    output: "interactive",
    valid: "true",
    value: true,
    wrong: "'true'",
  },
];

function resolveMatrix(
  identity: MatrixIdentity,
  field: MatrixField,
  state: "empty-string" | "null" | "omitted" | "value" | "wrong",
  body = "",
): AgentDefinitions {
  const { agentDirectory, cwd } = fixture();
  const project = join(cwd, ".pi", "agents");
  mkdirSync(project, { recursive: true });

  const lines =
    identity === "security" && field.key !== "description"
      ? ["description: Baseline security reviewer"]
      : [];
  if (state === "null") lines.push(`${field.key}: null`);
  if (state === "empty-string") lines.push(`${field.key}: ''`);
  if (state === "value") lines.push(`${field.key}: ${field.valid}`);
  if (state === "wrong") lines.push(`${field.key}: ${field.wrong}`);

  definition(project, identity, ["---", ...lines, "---", body].join("\n"));
  return AgentDefinitions.resolve({ agentDirectory, cwd });
}

const VALID_MATRIX_ROWS = MATRIX_IDENTITIES.flatMap((identity) =>
  FRONTMATTER_FIELD_MATRIX.flatMap((field) => [
    ...(identity === "security" && field.key === "description"
      ? []
      : [{ field, identity, state: "omitted" as const }]),
    { field, identity, state: "value" as const },
  ]),
);

test.each(VALID_MATRIX_ROWS)(
  "frontmatter field matrix accepts $identity $field.key $state",
  ({ field, identity, state }) => {
    const agent = resolveMatrix(identity, field, state).get(identity);

    expect(agent).toBeDefined();
    if (state === "value" && field.output)
      expect(agent?.[field.output as keyof typeof agent]).toEqual(field.value);
    if (state === "omitted" && field.key === "display_name")
      expect(agent?.displayName).toBe(identity);
  },
);

test("frontmatter field matrix rejects named description omission", () => {
  const field = FRONTMATTER_FIELD_MATRIX[0];
  if (!field) throw new Error("Missing description field fixture.");

  const definitions = resolveMatrix("security", field, "omitted");

  expect(definitions.get("security")).toBeUndefined();
  expect(definitions.diagnostic("security")?.reason).toBe(
    "named definitions require a non-empty description",
  );
});

const INVALID_MATRIX_ROWS = MATRIX_IDENTITIES.flatMap((identity) =>
  FRONTMATTER_FIELD_MATRIX.flatMap((field) =>
    (["null", "empty-string", "wrong"] as const).map((state) => ({
      field,
      identity,
      state,
    })),
  ),
);

test.each(INVALID_MATRIX_ROWS)(
  "frontmatter field matrix rejects $identity $field.key $state",
  ({ field, identity, state }) => {
    const definitions = resolveMatrix(identity, field, state);

    expect(definitions.get(identity)).toBeUndefined();
    expect(definitions.diagnostic(identity)?.reason).toBeTruthy();
  },
);

const CAPABILITY_FIELDS = ["tools", "extensions", "skills"] as const;
type CapabilityField = (typeof CAPABILITY_FIELDS)[number];

test.each([
  { field: "tools", value: "true", selection: { kind: "all" } },
  { field: "extensions", value: "false", selection: { kind: "none" } },
  { field: "skills", value: "[]", selection: { kind: "none" } },
  {
    field: "tools",
    value: "read, grep",
    selection: {
      kind: "fixed",
      entries: [
        { kind: "include", name: "read" },
        { kind: "include", name: "grep" },
      ],
    },
  },
  {
    field: "extensions",
    value: "[npm:one, npm:two]",
    selection: {
      kind: "fixed",
      entries: [
        { kind: "include", name: "npm:one" },
        { kind: "include", name: "npm:two" },
      ],
    },
  },
  {
    field: "skills",
    value: "[+research, -grilling, ++tdd]",
    selection: {
      kind: "parent-relative",
      entries: [
        { kind: "include", name: "research" },
        { kind: "exclude", name: "grilling" },
        { kind: "preload", name: "tdd" },
      ],
    },
  },
] as const)(
  "parses $field unified capability expression $value with provenance",
  ({ field, selection, value }) => {
    const { agentDirectory, cwd } = fixture();
    const project = join(cwd, ".pi", "agents");
    mkdirSync(project, { recursive: true });
    definition(
      project,
      "security",
      `---\ndescription: Review security\n${field}: ${value}\n---\n`,
    );

    expect(
      AgentDefinitions.resolve({ agentDirectory, cwd }).get("security"),
    ).toMatchObject({
      [field]: {
        selection,
        sourcePath: join(project, "security.md"),
      },
    });
  },
);

test.each(
  CAPABILITY_FIELDS.flatMap((field) => [
    { field, value: "null" },
    { field, value: "''" },
    { field, value: "42" },
    { field, value: "[one, '']" },
    { field, value: "[one, 42]" },
    { field, value: "[one, one]" },
    { field, value: "[+one, -one]" },
    { field, value: "[one, +two]" },
    ...(field === "skills"
      ? [{ field, value: "[one, ++one]" }]
      : [{ field, value: "[++one]" }]),
  ]),
)(
  "rejects malformed unified $field expression $value",
  ({ field, value }: { field: CapabilityField; value: string }) => {
    const { agentDirectory, cwd } = fixture();
    const project = join(cwd, ".pi", "agents");
    mkdirSync(project, { recursive: true });
    definition(
      project,
      "security",
      `---\ndescription: Review security\n${field}: ${value}\n---\n`,
    );

    const definitions = AgentDefinitions.resolve({ agentDirectory, cwd });
    expect(definitions.get("security")).toBeUndefined();
    expect(definitions.diagnostic("security")?.reason).toContain(field);
  },
);

test.each(MATRIX_IDENTITIES)(
  "ignores retired and unrelated frontmatter fields for %s",
  (identity) => {
    const { agentDirectory, cwd } = fixture();
    const project = join(cwd, ".pi", "agents");
    mkdirSync(project, { recursive: true });
    const baseline =
      identity === "security" ? "description: Shared-file reviewer\n" : "";
    definition(
      project,
      identity,
      [
        "---",
        baseline.trimEnd(),
        "disallowed_tools: [42]",
        "disallowed_extensions: 42",
        "available_skills: 42",
        "preload_skills: true",
        "unsupported_plugin_field: preserved elsewhere",
        "---",
      ]
        .filter(Boolean)
        .join("\n"),
    );

    const definitions = AgentDefinitions.resolve({ agentDirectory, cwd });
    const agent = definitions.get(identity);
    expect(agent).toBeDefined();
    expect(definitions.diagnostic(identity)).toBeUndefined();
    expect(agent?.tools).toBeUndefined();
    expect(agent?.extensions).toBeUndefined();
    expect(agent?.skills).toBeUndefined();
  },
);

test.each(MATRIX_IDENTITIES)(
  "rejects duplicate YAML keys for %s with Pi frontmatter parsing",
  (identity) => {
    const { agentDirectory, cwd } = fixture();
    const project = join(cwd, ".pi", "agents");
    mkdirSync(project, { recursive: true });
    definition(
      project,
      identity,
      "---\ndescription: First\ndescription: Second\n---\n",
    );

    const definitions = AgentDefinitions.resolve({ agentDirectory, cwd });

    expect(definitions.get(identity)).toBeUndefined();
    expect(definitions.diagnostic(identity)?.reason).toContain(
      "Map keys must be unique",
    );
  },
);

test.each(
  MATRIX_IDENTITIES.flatMap((identity) => [
    { content: "description: Missing boundaries\n", identity, kind: "absent" },
    {
      content: "prefix\n---\ndescription: Invalid location\n---\n",
      identity,
      kind: "prefixed",
    },
    {
      content: "\ufeff---\ndescription: BOM is not byte zero\n---\n",
      identity,
      kind: "BOM-prefixed",
    },
  ]),
)(
  "rejects $kind required frontmatter boundaries for $identity",
  ({ content, identity }) => {
    const { agentDirectory, cwd } = fixture();
    const project = join(cwd, ".pi", "agents");
    mkdirSync(project, { recursive: true });
    definition(project, identity, content);

    const definitions = AgentDefinitions.resolve({ agentDirectory, cwd });

    expect(definitions.get(identity)).toBeUndefined();
    expect(definitions.diagnostic(identity)?.reason).toBe(
      "agent definitions require YAML frontmatter boundaries",
    );
  },
);

test.each(MATRIX_IDENTITIES)(
  "treats a whitespace-only body as absent for %s",
  (identity) => {
    const field = FRONTMATTER_FIELD_MATRIX[0];
    if (!field) throw new Error("Missing description field fixture.");
    const definitions = resolveMatrix(identity, field, "value", " \n\t \n ");

    expect(definitions.get(identity)?.body).toBeUndefined();
  },
);

test("general-purpose tombstone removes global customization without disabling delegation", () => {
  const { agentDirectory, cwd } = fixture();
  const project = join(cwd, ".pi", "agents");
  const global = join(agentDirectory, "agents");
  mkdirSync(project, { recursive: true });
  mkdirSync(global, { recursive: true });
  definition(
    global,
    "general-purpose",
    "---\ndescription: Global customization\n---\nGlobal body\n",
  );
  definition(project, "general-purpose", "---\nenabled: false\n---\n");

  const definitions = AgentDefinitions.resolve({ agentDirectory, cwd });

  expect(definitions.get("general-purpose")).toBeUndefined();
  expect(definitions.diagnostic("general-purpose")).toBeUndefined();
  expect(definitions.names()).toEqual(["general-purpose"]);
  expect(definitions.guidelines()).toEqual([]);
});

test.each(MATRIX_IDENTITIES)(
  "ignores unsupported frontmatter without changing %s resolution",
  (identity) => {
    const { agentDirectory, cwd } = fixture();
    const project = join(cwd, ".pi", "agents");
    mkdirSync(project, { recursive: true });
    const baseline =
      identity === "security" ? "description: Shared-file reviewer\n" : "";
    definition(
      project,
      identity,
      `---\n${baseline}unsupported_plugin_field: preserved elsewhere\nskills: not-an-alias\n---\n`,
    );

    const definitions = AgentDefinitions.resolve({ agentDirectory, cwd });

    expect(definitions.get(identity)).toBeDefined();
    expect(definitions.diagnostic(identity)).toBeUndefined();
  },
);

test.each(MATRIX_IDENTITIES)(
  "preserves XML-like body content after boundary trimming for %s",
  (identity) => {
    const field = FRONTMATTER_FIELD_MATRIX[0];
    if (!field) throw new Error("Missing description field fixture.");
    const body =
      "\n<agent_instructions>Literal body tag.</agent_instructions>\n";
    const definitions = resolveMatrix(identity, field, "value", body);

    expect(definitions.get(identity)?.body).toBe(
      "<agent_instructions>Literal body tag.</agent_instructions>",
    );
  },
);

test("parses unified capability fields without interpreting retired names", () => {
  const { agentDirectory, cwd } = fixture();
  const project = join(cwd, ".pi", "agents");
  mkdirSync(project, { recursive: true });
  definition(
    project,
    "reviewer",
    [
      "---",
      "description: Review capability policy",
      "tools: [+read, -bash]",
      "extensions: [npm:pi-web-access]",
      "skills: [++tdd]",
      "disallowed_tools: invalid-but-ignored",
      "disallowed_extensions: invalid-but-ignored",
      "available_skills: 42",
      "preload_skills: true",
      "---",
    ].join("\n"),
  );

  const definitions = AgentDefinitions.resolve({ agentDirectory, cwd });

  expect(definitions.get("reviewer")).toMatchObject({
    tools: {
      sourcePath: join(project, "reviewer.md"),
      selection: {
        kind: "parent-relative",
        entries: [
          { kind: "include", name: "read" },
          { kind: "exclude", name: "bash" },
        ],
      },
    },
    extensions: {
      sourcePath: join(project, "reviewer.md"),
      selection: {
        kind: "fixed",
        entries: [{ kind: "include", name: "npm:pi-web-access" }],
      },
    },
    skills: {
      sourcePath: join(project, "reviewer.md"),
      selection: {
        kind: "fixed",
        entries: [{ kind: "preload", name: "tdd" }],
      },
    },
  });
  expect(definitions.diagnostic("reviewer")).toBeUndefined();
});

test("project capability expressions replace global expressions by field", () => {
  const { agentDirectory, cwd } = fixture();
  const project = join(cwd, ".pi", "agents");
  const global = join(agentDirectory, "agents");
  mkdirSync(project, { recursive: true });
  mkdirSync(global, { recursive: true });
  definition(
    global,
    "reviewer",
    "---\ndescription: Review capability policy\ntools: [read]\nextensions: true\nskills: [research]\n---\n",
  );
  definition(project, "reviewer", "---\ntools: [-bash]\nskills: []\n---\n");

  expect(
    AgentDefinitions.resolve({ agentDirectory, cwd }).get("reviewer"),
  ).toMatchObject({
    tools: {
      sourcePath: join(project, "reviewer.md"),
      selection: {
        kind: "parent-relative",
        entries: [{ kind: "exclude", name: "bash" }],
      },
    },
    extensions: {
      sourcePath: join(global, "reviewer.md"),
      selection: { kind: "all" },
    },
    skills: {
      sourcePath: join(project, "reviewer.md"),
      selection: { kind: "none" },
    },
  });
});
