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

test("project definitions shadow global definitions and produce the parent catalog", () => {
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
      "tools: read, grep, read",
      "disallowed_tools: [bash, edit, bash]",
      "available_skills: research, tdd, research",
      "preload_skills: [tdd, research, tdd]",
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
    tools: ["read", "grep"],
    disallowedTools: ["bash", "edit"],
    availableSkills: ["research", "tdd"],
    preloadSkills: ["tdd", "research"],
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
  "disallowed_tools: null",
  "available_skills: null",
  "preload_skills: null",
  "inherit_context: null",
  "interactive: null",
  "display_name: ''",
  "model: ''",
  "thinking: ''",
  "tools: ''",
  "disallowed_tools: ''",
  "available_skills: ''",
  "preload_skills: ''",
  "display_name: 42",
  "enabled: 'false'",
  "model: true",
  "thinking: true",
  "tools: true",
  "disallowed_tools: true",
  "available_skills: 42",
  "preload_skills: true",
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
    "---\ndescription: Review security\ntools: []\ndisallowed_tools: []\navailable_skills: []\npreload_skills: []\n---\n",
  );

  expect(
    AgentDefinitions.resolve({ agentDirectory, cwd }).get("security"),
  ).toMatchObject({
    tools: [],
    disallowedTools: [],
    availableSkills: [],
    preloadSkills: [],
  });
});

test("a malformed project definition shadows its valid global definition", () => {
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

test("disabled tombstones skip validation and suppress named agents", () => {
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
  expect(definitions.diagnostic("security")).toBeUndefined();
  expect(definitions.names()).toEqual(["general-purpose"]);
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
    | "tools"
    | "disallowed_tools"
    | "available_skills"
    | "preload_skills"
    | "inherit_context"
    | "interactive";
  empty?: string;
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
    key: "tools",
    empty: "[]",
    output: "tools",
    valid: "read, grep",
    value: ["read", "grep"],
    wrong: "true",
  },
  {
    key: "disallowed_tools",
    empty: "[]",
    output: "disallowedTools",
    valid: "bash, edit",
    value: ["bash", "edit"],
    wrong: "true",
  },
  {
    key: "available_skills",
    empty: "[]",
    output: "availableSkills",
    valid: "research, tdd",
    value: ["research", "tdd"],
    wrong: "42",
  },
  {
    key: "preload_skills",
    empty: "[]",
    output: "preloadSkills",
    valid: "research, tdd",
    value: ["research", "tdd"],
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
  state:
    | "empty-collection"
    | "empty-string"
    | "null"
    | "omitted"
    | "value"
    | "wrong",
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
  if (state === "empty-collection")
    lines.push(`${field.key}: ${field.empty ?? "[]"}`);
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
    ...(field.empty
      ? [{ field, identity, state: "empty-collection" as const }]
      : []),
  ]),
);

test.each(VALID_MATRIX_ROWS)(
  "frontmatter field matrix accepts $identity $field.key $state",
  ({ field, identity, state }) => {
    const agent = resolveMatrix(identity, field, state).get(identity);

    expect(agent).toBeDefined();
    if (state === "value" && field.output)
      expect(agent?.[field.output as keyof typeof agent]).toEqual(field.value);
    if (state === "empty-collection" && field.output)
      expect(agent?.[field.output as keyof typeof agent]).toEqual([]);
    if (state === "omitted") {
      if (field.key === "display_name")
        expect(agent?.displayName).toBe(identity);
      if (field.key === "disallowed_tools")
        expect(agent?.disallowedTools).toEqual([]);
      if (field.key === "preload_skills")
        expect(agent?.preloadSkills).toEqual([]);
      if (
        field.output &&
        !["displayName", "disallowedTools", "preloadSkills"].includes(
          field.output,
        )
      )
        expect(agent?.[field.output as keyof typeof agent]).toBeUndefined();
    }
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
      "enabled definitions require YAML frontmatter boundaries",
    );
  },
);

const COLLECTION_FIELDS = [
  { key: "tools", output: "tools" },
  { key: "disallowed_tools", output: "disallowedTools" },
  { key: "available_skills", output: "availableSkills" },
  { key: "preload_skills", output: "preloadSkills" },
] as const;

test.each(
  MATRIX_IDENTITIES.flatMap((identity) =>
    COLLECTION_FIELDS.flatMap((field) => [
      { field, identity, value: "[read, '']" },
      { field, identity, value: "[read, 42]" },
    ]),
  ),
)(
  "rejects invalid collection empty and non-string entries for $identity $field.key $value",
  ({ field, identity, value }) => {
    const { agentDirectory, cwd } = fixture();
    const project = join(cwd, ".pi", "agents");
    mkdirSync(project, { recursive: true });
    const baseline =
      identity === "security"
        ? "description: Baseline security reviewer\n"
        : "";
    definition(
      project,
      identity,
      `---\n${baseline}${field.key}: ${value}\n---\n`,
    );

    const definitions = AgentDefinitions.resolve({ agentDirectory, cwd });

    expect(definitions.get(identity)).toBeUndefined();
    expect(definitions.diagnostic(identity)?.reason).toContain(
      `${field.key} must be a comma-separated string or string list`,
    );
  },
);

test.each(
  MATRIX_IDENTITIES.flatMap((identity) =>
    COLLECTION_FIELDS.map((field) => ({ field, identity })),
  ),
)(
  "normalizes CSV/list equivalence and first-occurrence order for $identity $field.key",
  ({ field, identity }) => {
    const { agentDirectory, cwd } = fixture();
    const project = join(cwd, ".pi", "agents");
    mkdirSync(project, { recursive: true });
    const baseline =
      identity === "security"
        ? ["description: Baseline security reviewer"]
        : [];
    const source = (value: string) =>
      ["---", ...baseline, `${field.key}: ${value}`, "---", ""].join("\n");
    const output = field.output as keyof NonNullable<
      ReturnType<AgentDefinitions["get"]>
    >;

    definition(project, identity, source("read, grep, read"));
    const csv = AgentDefinitions.resolve({ agentDirectory, cwd }).get(identity);
    definition(project, identity, source("[read, grep, read]"));
    const list = AgentDefinitions.resolve({ agentDirectory, cwd }).get(
      identity,
    );

    expect(csv?.[output]).toEqual(["read", "grep"]);
    expect(list?.[output]).toEqual(["read", "grep"]);
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
  definition(
    project,
    "general-purpose",
    "---\nenabled: false\ntools: [42]\n---\n",
  );

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
