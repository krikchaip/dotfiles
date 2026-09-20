import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Context,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import {
  configureBasicDelegation,
  fauxSubagentDone,
} from "../provider-support.ts";

const SKILL_FILES = {
  "research/SKILL.md": [
    "---",
    "name: research",
    "description: Research evidence",
    "---",
    "RESEARCH PRELOAD INSTRUCTION",
  ].join("\n"),
  "tdd/SKILL.md": [
    "---",
    "name: tdd",
    "description: Test-driven delivery",
    "---",
    "TDD PRELOAD INSTRUCTION",
  ].join("\n"),
} as const;

function childCompleted(harness: E2EHarness): Promise<string> {
  return harness.waitFor("Child completed its delegated E2E task.", 15_000);
}

function matrixDefinition(lines: readonly string[]): string {
  return [
    "---",
    "description: Exercise collection policy",
    ...lines,
    "---",
  ].join("\n");
}

type CollectionCase = Readonly<{
  name: string;
  frontmatter: readonly string[];
  childSystemPromptExcludes?: readonly string[];
  childSystemPromptIncludes?: readonly string[];
  childToolExcludes?: readonly string[];
  childToolIncludes?: readonly string[];
}>;

const collectionCases: readonly CollectionCase[] = [
  {
    name: "agent-tools-csv",
    frontmatter: ["tools: read, grep"],
    childToolIncludes: ["read", "grep"],
    childToolExcludes: ["bash", "Agent"],
  },
  {
    name: "agent-tools-yaml-list",
    frontmatter: ["tools: [read, grep]"],
    childToolIncludes: ["read", "grep"],
    childToolExcludes: ["bash", "Agent"],
  },
  {
    name: "agent-tools-explicit-empty",
    frontmatter: ["tools: []"],
    childToolExcludes: ["read", "grep", "bash", "Agent"],
  },
  {
    name: "agent-disallowed-tools-csv",
    frontmatter: ["tools: [read, grep]", "disallowed_tools: grep"],
    childToolIncludes: ["read"],
    childToolExcludes: ["grep", "Agent"],
  },
  {
    name: "agent-disallowed-tools-yaml-list",
    frontmatter: ["tools: [read, grep]", "disallowed_tools: [grep]"],
    childToolIncludes: ["read"],
    childToolExcludes: ["grep", "Agent"],
  },
  {
    name: "agent-disallowed-tools-explicit-empty",
    frontmatter: ["tools: [read, grep]", "disallowed_tools: []"],
    childToolIncludes: ["read", "grep"],
    childToolExcludes: ["Agent"],
  },
  {
    name: "agent-available-skills-csv",
    frontmatter: ["tools: [read]", "available_skills: research, tdd"],
    childSystemPromptIncludes: ["<name>research</name>", "<name>tdd</name>"],
  },
  {
    name: "agent-available-skills-yaml-list",
    frontmatter: ["tools: [read]", "available_skills: [research, tdd]"],
    childSystemPromptIncludes: ["<name>research</name>", "<name>tdd</name>"],
  },
  {
    name: "agent-available-skills-explicit-empty",
    frontmatter: ["tools: [read]", "available_skills: []"],
    childSystemPromptExcludes: ["<name>research</name>", "<name>tdd</name>"],
  },
  {
    name: "agent-preload-skills-csv",
    frontmatter: ["tools: [read]", "preload_skills: research, tdd"],
    childSystemPromptIncludes: [
      '<skill name="research"',
      "RESEARCH PRELOAD INSTRUCTION",
      '<skill name="tdd"',
      "TDD PRELOAD INSTRUCTION",
    ],
  },
  {
    name: "agent-preload-skills-yaml-list",
    frontmatter: ["tools: [read]", "preload_skills: [research, tdd]"],
    childSystemPromptIncludes: [
      '<skill name="research"',
      "RESEARCH PRELOAD INSTRUCTION",
      '<skill name="tdd"',
      "TDD PRELOAD INSTRUCTION",
    ],
  },
  {
    name: "agent-preload-skills-explicit-empty",
    frontmatter: ["tools: [read]", "preload_skills: []"],
    childSystemPromptExcludes: [
      '<skill name="research"',
      "RESEARCH PRELOAD INSTRUCTION",
      '<skill name="tdd"',
      "TDD PRELOAD INSTRUCTION",
    ],
  },
];

function collectionScenario(testCase: CollectionCase): Scenario {
  return {
    name: testCase.name,
    process: {
      agentDefinitions: {
        matrix: matrixDefinition(testCase.frontmatter),
      },
      managed: true,
      positionalPrompt: `Launch ${testCase.name}.`,
      skillFiles: SKILL_FILES,
    },
    configureProvider(context) {
      configureBasicDelegation(context, {
        childSystemPromptExcludes: testCase.childSystemPromptExcludes,
        childSystemPromptIncludes: testCase.childSystemPromptIncludes,
        childToolExcludes: testCase.childToolExcludes,
        childToolIncludes: testCase.childToolIncludes,
        description: testCase.name,
        prompt: `Validate ${testCase.name} in the real child.`,
        subagentType: "matrix",
      });
    },
    async run(harness: E2EHarness) {
      await childCompleted(harness);
    },
  };
}

/** Rows 81: each collection syntax reaches the real child prompt or tool surface. */
export const agentCollectionPolicyScenarios =
  collectionCases.map(collectionScenario);

type InvalidDefinitionCase = Readonly<{
  field: string;
  kind: "general-purpose" | "named";
  name: string;
  value: string;
}>;

const invalidDefinitionCases: readonly InvalidDefinitionCase[] = [
  {
    name: "agent-invalid-named-yaml-null",
    kind: "named",
    field: "description",
    value: "null",
  },
  {
    name: "agent-invalid-named-empty-string",
    kind: "named",
    field: "description",
    value: "''",
  },
  {
    name: "agent-invalid-general-purpose-yaml-null",
    kind: "general-purpose",
    field: "description",
    value: "null",
  },
  {
    name: "agent-invalid-general-purpose-empty-string",
    kind: "general-purpose",
    field: "description",
    value: "''",
  },
];

function rejectedLaunch(
  context: ProviderContext,
  kind: InvalidDefinitionCase["kind"],
): void {
  if (context.role === "child")
    throw new Error("A malformed agent definition started a child process.");

  const call = (subagentType?: string) =>
    fauxAssistantMessage(
      fauxToolCall("Agent", {
        description: "malformed definition launch",
        prompt: "Attempt the rejected launch.",
        ...(subagentType ? { subagent_type: subagentType } : {}),
      }),
      { stopReason: "toolUse" },
    );

  context.faux.setResponses(
    kind === "general-purpose"
      ? [
          call(),
          call("general-purpose"),
          fauxAssistantMessage(
            fauxText("Both malformed general-purpose launches were rejected."),
          ),
        ]
      : [
          call("security"),
          fauxAssistantMessage(
            fauxText("The malformed named launch was rejected."),
          ),
        ],
  );
}

function invalidDefinitionScenario(testCase: InvalidDefinitionCase): Scenario {
  const name = testCase.kind === "named" ? "security" : "general-purpose";
  const validGlobal = [
    "---",
    "description: Global fallback must not be used",
    "---",
    "GLOBAL FALLBACK BODY MUST NOT LAUNCH",
  ].join("\n");
  const invalidProject = [
    "---",
    `${testCase.field}: ${testCase.value}`,
    "---",
  ].join("\n");

  return {
    name: testCase.name,
    process: {
      agentDefinitions: { [name]: invalidProject },
      fauxProvider: true,
      globalAgentDefinitions: { [name]: validGlobal },
      positionalPrompt: `Attempt ${testCase.name}.`,
    },
    configureProvider(context) {
      rejectedLaunch(context, testCase.kind);
    },
    async run(harness: E2EHarness) {
      const warning = await harness.waitFor(
        "Side Quests ignored malformed agent definition",
        8_000,
      );
      await harness.waitFor(
        testCase.kind === "general-purpose"
          ? "Both malformed general-purpose launches were rejected."
          : "The malformed named launch was rejected.",
        8_000,
      );

      harness.assert(
        warning.includes(`${name}.md`) && warning.includes(testCase.field),
        `Malformed ${testCase.kind} warning lacks the path or field.\n${warning}`,
      );
      harness.assert(
        (await harness.childPanes()).length === 0,
        `Malformed ${testCase.kind} launch created a child pane.`,
      );
      harness.assert(
        harness.filesNamed("session.jsonl").length === 0,
        `Malformed ${testCase.kind} launch created a child session.`,
      );
    },
  };
}

/** Row 82: null and empty strings fail without a child, session, or fallback. */
export const invalidAgentDefinitionScenarios = invalidDefinitionCases.map(
  invalidDefinitionScenario,
);

export const generalPurposeTombstone: Scenario = {
  name: "agent-general-purpose-tombstone",
  process: {
    agentDefinitions: {
      "general-purpose": "---\nenabled: false\n---\n",
    },
    globalAgentDefinitions: {
      "general-purpose": [
        "---",
        "description: Global customization",
        "---",
        "GLOBAL TOMBSTONE BODY MUST NOT REACH CHILD",
      ].join("\n"),
    },
    managed: true,
    positionalPrompt: "Launch the tombstoned general-purpose child.",
  },
  configureProvider(context) {
    configureBasicDelegation(context, {
      childSystemPromptExcludes: [
        "GLOBAL TOMBSTONE BODY MUST NOT REACH CHILD",
        "<agent_instructions>",
      ],
      description: "general tombstone",
      prompt: "Prove the general-purpose tombstone restores the parent clone.",
    });
  },
  async run(harness: E2EHarness) {
    await childCompleted(harness);
  },
};

export const namedAgentTombstone: Scenario = {
  name: "agent-named-tombstone",
  process: {
    agentDefinitions: {
      security: "---\nenabled: false\n---\n",
    },
    fauxProvider: true,
    globalAgentDefinitions: {
      security: [
        "---",
        "description: Global security fallback",
        "---",
        "GLOBAL NAMED TOMBSTONE BODY MUST NOT LAUNCH",
      ].join("\n"),
    },
    positionalPrompt: "Attempt the tombstoned named child.",
  },
  configureProvider(context) {
    if (context.role === "child")
      throw new Error("A named tombstone started a child process.");

    context.faux.setResponses([
      (providerContext: Context) => {
        const catalog = providerContext.systemPrompt ?? "";
        return !catalog.includes("Global security fallback") &&
          !catalog.includes("Subagent security.")
          ? fauxAssistantMessage(
              fauxToolCall("Agent", {
                description: "named tombstone",
                prompt: "Attempt the disabled named agent.",
                subagent_type: "security",
              }),
              { stopReason: "toolUse" },
            )
          : fauxAssistantMessage("Named tombstone stayed in the catalog.", {
              stopReason: "error",
              errorMessage: "Named tombstone stayed in the catalog.",
            });
      },
      fauxAssistantMessage(
        fauxText("The named tombstone launch was rejected."),
      ),
    ]);
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("The named tombstone launch was rejected.", 8_000);
    harness.assert(
      (await harness.childPanes()).length === 0,
      "Named tombstone launch created a child pane.",
    );
    harness.assert(
      harness.filesNamed("session.jsonl").length === 0,
      "Named tombstone launch created a child session.",
    );
  },
};

function exactCatalog(
  systemPrompt: string,
  entries: readonly string[],
): boolean {
  const guidance =
    "When a side quest matches a specialized sub-agent below, delegate that side quest directly to that sub-agent.";
  const expected = [guidance, ...entries].map((entry) => `- ${entry}`);
  const lines = systemPrompt.split("\n");

  return lines.some(
    (line, start) =>
      line === expected[0] &&
      expected.every((entry, offset) => lines[start + offset] === entry),
  );
}

export const agentCatalogRefresh: Scenario = {
  name: "agent-catalog-refresh-order",
  process: {
    agentDefinitions: {
      alpha: "---\ndescription: Alpha review\n---\n",
      beta: "---\ndescription: Beta review\n---\n",
      "general-purpose": "---\ndescription: General review\n---\n",
    },
    fauxProvider: true,
    positionalPrompt: "Inspect the initial agent catalog.",
  },
  configureProvider(context) {
    if (context.role === "child")
      throw new Error("Catalog inspection must not launch a child.");

    context.faux.setResponses([
      (providerContext: Context) => {
        const catalog = providerContext.systemPrompt ?? "";
        const messages = JSON.stringify(providerContext.messages);

        if (messages.includes("Inspect catalog removal."))
          return !catalog.includes("When a side quest matches") &&
            !catalog.includes("Subagent general-purpose.")
            ? fauxAssistantMessage(
                fauxText("Conditional catalog removal is correct."),
              )
            : fauxAssistantMessage("Conditional catalog removal is wrong.", {
                stopReason: "error",
                errorMessage: "Conditional catalog removal is wrong.",
              });

        if (messages.includes("Inspect the refreshed agent catalog."))
          return exactCatalog(catalog, [
            "Subagent beta. Beta review",
            "Subagent gamma. Gamma review",
            "Subagent general-purpose. General review",
          ]) && !catalog.includes("Subagent alpha.")
            ? fauxAssistantMessage(
                fauxText("Reloaded catalog order is correct."),
              )
            : fauxAssistantMessage("Reloaded catalog order is wrong.", {
                stopReason: "error",
                errorMessage: "Reloaded catalog order is wrong.",
              });

        return exactCatalog(catalog, [
          "Subagent alpha. Alpha review",
          "Subagent beta. Beta review",
          "Subagent general-purpose. General review",
        ])
          ? fauxAssistantMessage(fauxText("Initial catalog order is correct."))
          : fauxAssistantMessage("Initial catalog order is wrong.", {
              stopReason: "error",
              errorMessage: "Initial catalog order is wrong.",
            });
      },
    ]);
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("Initial catalog order is correct.", 8_000);
    const agents = join(harness.workDirectory, ".pi", "agents");
    rmSync(join(agents, "alpha.md"));
    writeFileSync(
      join(agents, "gamma.md"),
      "---\ndescription: Gamma review\n---\n",
    );
    await harness.sendParent("/reload", true);
    await Bun.sleep(1_500);
    await harness.sendParent("Inspect the refreshed agent catalog.", true);
    await harness.waitFor("Reloaded catalog order is correct.", 8_000);

    rmSync(join(agents, "beta.md"));
    rmSync(join(agents, "gamma.md"));
    await harness.sendParent("/reload", true);
    await Bun.sleep(1_500);
    await harness.sendParent("Inspect catalog removal.", true);
    await harness.waitFor("Conditional catalog removal is correct.", 8_000);
  },
};

export const agentCallOverridePriority: Scenario = {
  name: "agent-call-override-priority",
  process: {
    agentDefinitions: {
      security: [
        "---",
        "description: Override priority reviewer",
        "tools: [read]",
        "inherit_context: true",
        "interactive: true",
        "---",
      ].join("\n"),
    },
    managed: true,
    positionalPrompt: "Launch with explicit false overrides.",
  },
  configureProvider(context) {
    configureBasicDelegation(context, {
      childToolIncludes: ["read"],
      childToolExcludes: ["grep"],
      description: "override priority",
      inheritContext: false,
      interactive: false,
      prompt:
        "Prove per-call false overrides win over frontmatter true values.",
      subagentType: "security",
    });
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("SUBAGENT COMPLETED", 15_000);
    const manifest = harness.filesNamed("manifest.json")[0];
    harness.assert(manifest, "Override-priority child manifest is missing.");
    const content = harness.read(manifest);
    harness.assert(
      content.includes('"inheritContext":false') &&
        content.includes('"lifecycle":"autonomous"'),
      `Per-call false overrides did not win.\n${content}`,
    );
  },
};

function canonicalResumePath(): string | undefined {
  const stateDirectory = process.env.PI_CODING_AGENT_DIR;
  if (!stateDirectory) return undefined;

  const sessions = join(stateDirectory, "side-quests", "sessions");
  const parents = readdirSync(sessions, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory(),
  );
  const parent = parents[0]?.name;
  if (!parent) return undefined;
  const children = readdirSync(join(sessions, parent), {
    withFileTypes: true,
  }).filter((entry) => entry.isDirectory());
  const child = children[0]?.name;
  return child ? join(sessions, parent, child, "session.jsonl") : undefined;
}

function immutableChildResponse(providerContext: Context) {
  const toolNames = new Set(
    (providerContext.tools ?? []).map((tool) => tool.name),
  );
  return toolNames.has("read") && !toolNames.has("grep")
    ? fauxSubagentDone("Restricted policy persisted through resume.")
    : fauxAssistantMessage("Restricted policy changed across resume.", {
        stopReason: "error",
        errorMessage: "Restricted policy changed across resume.",
      });
}

export const agentResumePermissionsImmutable: Scenario = {
  name: "agent-resume-permissions-immutable",
  process: {
    agentDefinitions: {
      security: "---\ndescription: Restricted reviewer\ntools: [read]\n---\n",
    },
    managed: true,
    positionalPrompt: "Launch the restricted reviewer.",
  },
  configureProvider(context) {
    if (context.role === "child") {
      context.faux.setResponses([immutableChildResponse]);
      return;
    }

    context.faux.setResponses([
      (providerContext: Context) => {
        const resumed = (providerContext.systemPrompt ?? "").includes(
          "Subagent security. Broadened after launch",
        );

        if (!resumed) {
          context.faux.appendResponses([
            fauxAssistantMessage(
              fauxText("Initial restricted child is running."),
            ),
            fauxAssistantMessage(
              fauxText("Initial restricted child completed."),
            ),
          ]);
          return fauxAssistantMessage(
            fauxToolCall("Agent", {
              description: "restricted launch",
              prompt: "Complete the initial restricted review.",
              subagent_type: "security",
            }),
            { stopReason: "toolUse" },
          );
        }

        const resume = canonicalResumePath();
        if (!resume)
          return fauxAssistantMessage("Missing restricted resume path.", {
            stopReason: "error",
            errorMessage: "Missing restricted resume path.",
          });

        context.faux.appendResponses([
          fauxAssistantMessage(fauxText("Restricted child resumed.")),
        ]);
        return fauxAssistantMessage(
          fauxToolCall("Agent", {
            description: "restricted resume",
            prompt: "Prove the stored restricted policy remains active.",
            resume,
          }),
          { stopReason: "toolUse" },
        );
      },
    ]);
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("Initial restricted child completed.", 15_000);
    const agents = join(harness.workDirectory, ".pi", "agents");
    writeFileSync(
      join(agents, "security.md"),
      "---\ndescription: Broadened after launch\ntools: [grep]\n---\n",
    );
    await harness.sendParent("/reload", true);
    await Bun.sleep(1_500);
    await harness.sendParent("Resume the restricted reviewer.", true);
    await harness.waitFor("Restricted child resumed.", 15_000);
    await harness.waitFor("SUBAGENT COMPLETED", 15_000);
  },
};
