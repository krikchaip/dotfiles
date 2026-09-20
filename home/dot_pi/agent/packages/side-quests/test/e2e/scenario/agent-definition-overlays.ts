import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import { configureBasicDelegation } from "../provider-support.ts";

const RESEARCH_SKILL = {
  "research/SKILL.md": [
    "---",
    "name: research",
    "description: Research evidence",
    "---",
    "RESEARCH OVERLAY PRELOAD",
  ].join("\n"),
} as const;

function rejectedNamedLaunch(
  context: ProviderContext,
  completion: string,
): void {
  if (context.role === "child")
    throw new Error("A rejected overlay definition started a child process.");

  context.faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("Agent", {
        description: "overlay rejection",
        prompt: "Attempt the rejected overlay launch.",
        subagent_type: "security",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxText(completion)),
  ]);
}

function assertNoChild(harness: E2EHarness, label: string): Promise<void> {
  return harness.childPanes().then((panes) => {
    harness.assert(panes.length === 0, `${label} created a child pane.`);
    harness.assert(
      harness.filesNamed("session.jsonl").length === 0,
      `${label} created a child session.`,
    );
  });
}

const replacesCollectionFields: Scenario = {
  name: "agent-overlay-replaces-collection-fields",
  process: {
    agentDefinitions: {
      security: [
        "---",
        "tools: [bash]",
        "disallowed_tools: []",
        "available_skills: []",
        "preload_skills: []",
        "---",
      ].join("\n"),
    },
    globalAgentDefinitions: {
      security: [
        "---",
        "description: Global collection reviewer",
        "tools: [read, grep]",
        "disallowed_tools: [bash]",
        "available_skills: [research]",
        "preload_skills: [research]",
        "---",
      ].join("\n"),
    },
    managed: true,
    positionalPrompt: "Launch the collection overlay reviewer.",
    skillFiles: RESEARCH_SKILL,
  },
  configureProvider(context) {
    configureBasicDelegation(context, {
      childSystemPromptExcludes: [
        "<name>research</name>",
        "RESEARCH OVERLAY PRELOAD",
      ],
      childToolExcludes: ["read", "grep"],
      childToolIncludes: ["bash"],
      description: "collection overlay",
      prompt: "Validate collection replacement.",
      subagentType: "security",
    });
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("Child completed its delegated E2E task.", 15_000);
  },
};

function bodyScenario(
  name: string,
  projectBody: string,
  included: string,
  excluded: string,
): Scenario {
  return {
    name,
    process: {
      agentDefinitions: {
        security: `---\n---${projectBody}`,
      },
      globalAgentDefinitions: {
        security:
          "---\ndescription: Global body reviewer\n---\nGLOBAL OVERLAY BODY",
      },
      managed: true,
      positionalPrompt: `Launch ${name}.`,
    },
    configureProvider(context) {
      configureBasicDelegation(context, {
        childSystemPromptExcludes: [excluded],
        childSystemPromptIncludes: [included],
        description: name,
        prompt: "Validate body overlay behavior.",
        subagentType: "security",
      });
    },
    async run(harness: E2EHarness) {
      await harness.waitFor("Child completed its delegated E2E task.", 15_000);
    },
  };
}

const inheritsGlobalBody = bodyScenario(
  "agent-overlay-inherits-global-body",
  "\n \n\t ",
  "GLOBAL OVERLAY BODY",
  "PROJECT OVERLAY BODY",
);

const inheritsGlobalBodyWhenAbsent = bodyScenario(
  "agent-overlay-inherits-global-body-when-absent",
  "",
  "GLOBAL OVERLAY BODY",
  "PROJECT OVERLAY BODY",
);

const replacesGlobalBody = bodyScenario(
  "agent-overlay-replaces-global-body",
  "\nPROJECT OVERLAY BODY",
  "PROJECT OVERLAY BODY",
  "GLOBAL OVERLAY BODY",
);

function malformedOverlayScenario(options: {
  readonly completion: string;
  readonly global: string;
  readonly name: string;
  readonly project: string;
  readonly warningScope: "global" | "project";
}): Scenario {
  return {
    name: options.name,
    process: {
      agentDefinitions: { security: options.project },
      fauxProvider: true,
      globalAgentDefinitions: { security: options.global },
      positionalPrompt: `Attempt ${options.name}.`,
    },
    configureProvider(context) {
      rejectedNamedLaunch(context, options.completion);
    },
    async run(harness: E2EHarness) {
      const warning = await harness.waitFor(
        "Side Quests ignored malformed agent definition",
        8_000,
      );
      await harness.waitFor(options.completion, 8_000);
      const pathSuffix =
        options.warningScope === "global"
          ? "-state/agents/security.md"
          : "-cwd/.pi/agents/security.md";
      harness.assert(
        warning.includes(pathSuffix),
        `Overlay warning did not identify the malformed ${options.warningScope} file.\n${warning}`,
      );
      await assertNoChild(harness, options.name);
    },
  };
}

const rejectsOverriddenInvalidGlobal = malformedOverlayScenario({
  completion: "Overridden malformed global was rejected.",
  global: "---\ndescription: 42\n---\n",
  name: "agent-overlay-rejects-overridden-invalid-global",
  project: "---\ndescription: Valid project description\n---\n",
  warningScope: "global",
});

const rejectsOverriddenUnknownGlobalModel: Scenario = {
  name: "agent-overlay-rejects-overridden-unknown-global-model",
  process: {
    agentDefinitions: {
      security: "---\nenabled: true\nmodel: side-quests-e2e/fake\n---\n",
    },
    fauxProvider: true,
    globalAgentDefinitions: {
      security: [
        "---",
        "description: Global runtime validation reviewer",
        "enabled: false",
        "model: missing-provider/missing-model",
        "---",
      ].join("\n"),
    },
    positionalPrompt: "Attempt the runtime-invalid overlay.",
  },
  configureProvider(context) {
    rejectedNamedLaunch(
      context,
      "Overridden unavailable global model was rejected.",
    );
  },
  async run(harness: E2EHarness) {
    const warning = await harness.waitFor(
      "Side Quests ignored malformed agent definition",
      8_000,
    );
    await harness.waitFor(
      "Overridden unavailable global model was rejected.",
      8_000,
    );
    harness.assert(
      warning.includes("-state/agents/security.md") &&
        warning.includes("unknown model: missing-provider/missing-model"),
      `Runtime validation warning did not identify the unavailable global model.\n${warning}`,
    );
    await assertNoChild(harness, "Overridden unavailable global model overlay");
  },
};

const projectEnabledOverridesGlobal: Scenario = {
  name: "agent-overlay-project-enabled-overrides-global",
  process: {
    agentDefinitions: {
      security: "---\nenabled: true\n---\n",
    },
    globalAgentDefinitions: {
      security: [
        "---",
        "description: Restored global reviewer",
        "enabled: false",
        "---",
      ].join("\n"),
    },
    managed: true,
    positionalPrompt: "Launch the restored overlay reviewer.",
  },
  configureProvider(context) {
    configureBasicDelegation(context, {
      description: "enabled overlay",
      prompt: "Validate enabled precedence.",
      subagentType: "security",
    });
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("Child completed its delegated E2E task.", 15_000);
    const manifest = harness.filesNamed("manifest.json")[0];
    harness.assert(manifest, "Restored overlay child manifest is missing.");
    harness.assert(
      harness.read(manifest).includes('"displayName":"security"'),
      "Restored overlay did not inherit enough global definition data to launch.",
    );
  },
};

function disabledOverlayScenario(
  name: string,
  globalEnabled: boolean,
  projectEnabled?: boolean,
): Scenario {
  const project = [
    "---",
    "description: Project security reviewer",
    ...(projectEnabled === undefined
      ? []
      : [`enabled: ${String(projectEnabled)}`]),
    "---",
  ].join("\n");
  const completion = `${name} stayed disabled.`;

  return {
    name,
    process: {
      agentDefinitions: { security: project },
      fauxProvider: true,
      globalAgentDefinitions: {
        security: [
          "---",
          "description: Global security reviewer",
          `enabled: ${String(globalEnabled)}`,
          "---",
        ].join("\n"),
      },
      positionalPrompt: `Attempt ${name}.`,
    },
    configureProvider(context) {
      rejectedNamedLaunch(context, completion);
    },
    async run(harness: E2EHarness) {
      await harness.waitFor(completion, 8_000);
      await assertNoChild(harness, name);
    },
  };
}

const projectFalseDisablesGlobal = disabledOverlayScenario(
  "agent-overlay-project-false-disables-global",
  true,
  false,
);

const projectOmissionInheritsGlobalFalse = disabledOverlayScenario(
  "agent-overlay-project-omission-inherits-global-false",
  false,
);

const validatesDescriptionAfterOverlay: Scenario = {
  name: "agent-overlay-validates-description-after-overlay",
  process: {
    agentDefinitions: {
      security: "---\nmodel: side-quests-e2e/fake\n---\n",
    },
    fauxProvider: true,
    positionalPrompt: "Attempt the description-less overlay.",
  },
  configureProvider(context) {
    rejectedNamedLaunch(context, "Description-less overlay was rejected.");
  },
  async run(harness: E2EHarness) {
    const warning = await harness.waitFor(
      "named definitions require a non-empty description",
      8_000,
    );
    await harness.waitFor("Description-less overlay was rejected.", 8_000);
    harness.assert(
      warning.includes("security.md"),
      `Description warning omitted the file path.\n${warning}`,
    );
    await assertNoChild(harness, "Description-less overlay");
  },
};

const inheritsGlobalDescription: Scenario = {
  name: "agent-overlay-inherits-global-description",
  process: {
    agentDefinitions: {
      security: "---\nmodel: side-quests-e2e/fake\n---\n",
    },
    globalAgentDefinitions: {
      security: "---\ndescription: Global description provider\n---\n",
    },
    managed: true,
    positionalPrompt: "Launch the description overlay reviewer.",
  },
  configureProvider(context) {
    configureBasicDelegation(context, {
      description: "description overlay",
      prompt: "Validate post-overlay description.",
      subagentType: "security",
    });
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("Child completed its delegated E2E task.", 15_000);
  },
};

const usesParentDefaultAfterDoubleOmission: Scenario = {
  name: "agent-overlay-uses-parent-default-after-double-omission",
  process: {
    agentDefinitions: { security: "---\n---\n" },
    globalAgentDefinitions: {
      security: "---\ndescription: Parent default reviewer\n---\n",
    },
    managed: true,
    positionalPrompt: "Launch the parent-default overlay reviewer.",
    skillFiles: RESEARCH_SKILL,
  },
  configureProvider(context) {
    configureBasicDelegation(context, {
      childSystemPromptIncludes: ["<name>research</name>"],
      childToolExcludes: ["grep"],
      childToolIncludes: ["read", "bash", "edit", "write"],
      description: "parent defaults",
      prompt: "Validate inherited parent defaults.",
      subagentType: "security",
    });
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("Child completed its delegated E2E task.", 15_000);
    const manifest = harness.filesNamed("manifest.json")[0];
    harness.assert(manifest, "Parent-default child manifest is missing.");
    const content = harness.read(manifest);
    harness.assert(
      content.includes('"model":"side-quests-e2e/fake"') &&
        content.includes('"thinking":"off"') &&
        content.includes('"tools":["read","bash","edit","write"]') &&
        content.includes("research/SKILL.md"),
      `Double omission did not inherit the parent runtime defaults.\n${content}`,
    );
  },
};

const restoredAgentInheritsGlobalFields: Scenario = {
  name: "agent-overlay-restored-agent-inherits-global-fields",
  process: {
    agentDefinitions: {
      security: "---\nenabled: true\n---\n",
    },
    globalAgentDefinitions: {
      security: [
        "---",
        "description: Restored policy reviewer",
        "display_name: Restored reviewer",
        "enabled: false",
        "tools: [read]",
        "available_skills: [research]",
        "preload_skills: [research]",
        "---",
        "RESTORED GLOBAL BODY",
      ].join("\n"),
    },
    managed: true,
    positionalPrompt: "Launch the restored policy reviewer.",
    skillFiles: RESEARCH_SKILL,
  },
  configureProvider(context) {
    configureBasicDelegation(context, {
      childSystemPromptExcludes: ["<name>research</name>"],
      childSystemPromptIncludes: [
        "RESEARCH OVERLAY PRELOAD",
        "RESTORED GLOBAL BODY",
      ],
      childToolExcludes: ["grep", "bash"],
      childToolIncludes: ["read"],
      description: "restored fields",
      prompt: "Validate restored global fields.",
      subagentType: "security",
    });
  },
  async run(harness: E2EHarness) {
    await harness.waitFor("Child completed its delegated E2E task.", 15_000);
    const manifest = harness.filesNamed("manifest.json")[0];
    harness.assert(manifest, "Restored overlay child manifest is missing.");
    harness.assert(
      harness.read(manifest).includes('"displayName":"Restored reviewer"'),
      "Restored overlay did not inherit the global display name.",
    );
  },
};

const tombstoneValidatesGlobal = malformedOverlayScenario({
  completion: "Malformed global under tombstone was rejected.",
  global: "---\ntools: [42]\n---\n",
  name: "agent-overlay-tombstone-validates-global",
  project: "---\nenabled: false\n---\n",
  warningScope: "global",
});

const validatesDisabledGlobalFields = malformedOverlayScenario({
  completion: "Malformed disabled global was rejected.",
  global: "---\nenabled: false\ntools: [42]\n---\n",
  name: "agent-overlay-validates-disabled-layer-fields",
  project: "---\nenabled: true\n---\n",
  warningScope: "global",
});

const validatesDisabledProjectFields = malformedOverlayScenario({
  completion: "Malformed disabled project was rejected.",
  global: "---\ndescription: Valid global reviewer\n---\n",
  name: "agent-overlay-validates-disabled-project-fields",
  project: "---\nenabled: false\ntools: [42]\n---\n",
  warningScope: "project",
});

export const agentDefinitionOverlayScenarios: readonly Scenario[] = [
  replacesCollectionFields,
  inheritsGlobalBody,
  inheritsGlobalBodyWhenAbsent,
  replacesGlobalBody,
  rejectsOverriddenInvalidGlobal,
  rejectsOverriddenUnknownGlobalModel,
  projectEnabledOverridesGlobal,
  projectFalseDisablesGlobal,
  projectOmissionInheritsGlobalFalse,
  validatesDescriptionAfterOverlay,
  inheritsGlobalDescription,
  usesParentDefaultAfterDoubleOmission,
  restoredAgentInheritsGlobalFields,
  tombstoneValidatesGlobal,
  validatesDisabledGlobalFields,
  validatesDisabledProjectFields,
];
