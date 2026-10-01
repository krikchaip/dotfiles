import { activeContinuation } from "./scenario/active-continuation.ts";
import { activeParentEvent } from "./scenario/active-parent-event.ts";
import { activePromotionRejection } from "./scenario/active-promotion.ts";
import {
  agentCallOverridePriority,
  agentCatalogRefresh,
  agentCollectionPolicyScenarios,
  agentResumePermissionsImmutable,
  generalPurposeTombstone,
  invalidAgentDefinitionScenarios,
  namedAgentTombstone,
} from "./scenario/agent-definition-matrix.ts";
import { agentDefinitionOverlayScenarios } from "./scenario/agent-definition-overlays.ts";
import { askParent } from "./scenario/ask-parent.ts";
import {
  extensionCanonicalAliasConflict,
  hiddenSkillExplicitSelection,
} from "./scenario/capability-known-red.ts";
import { child } from "./scenario/child.ts";
import { descriptionOnlyNamedAgent } from "./scenario/description-only-named-agent.ts";
import { diskSafeFirstPrompt } from "./scenario/disk-safe-first-prompt.ts";
import {
  diskSafeColdLaunch,
  diskSafeLaunchRefusal,
  diskSafeWarmLaunch,
} from "./scenario/disk-safe-launch.ts";
import {
  emptyGeneralPurposeExplicit,
  emptyGeneralPurposeOmitted,
} from "./scenario/empty-general-purpose.ts";
import { exhaustedProvider } from "./scenario/exhausted-provider.ts";
import { explicitCompletion } from "./scenario/explicit-completion.ts";
import {
  extensionAllChildTools,
  extensionChildToolReopen,
} from "./scenario/extension-child-tool.ts";
import {
  extensionDependencyScenarios,
  inheritedDependencyReopen,
} from "./scenario/extension-dependency-snapshot.ts";
import { extensionDirectOverlapScenarios } from "./scenario/extension-direct-overlap.ts";
import { extensionDirectRemoval } from "./scenario/extension-direct-removal.ts";
import { extensionExecutesOnce } from "./scenario/extension-executes-once.ts";
import { extensionFreshSettings } from "./scenario/extension-fresh-settings.ts";
import { extensionOfflineSelectionScenarios } from "./scenario/extension-offline-selection.ts";
import { extensionReducedParentSnapshot } from "./scenario/extension-parent-snapshot.ts";
import { extensionPathSelectionScenarios } from "./scenario/extension-path-selection.ts";
import { extensionSelectionMatrixScenarios } from "./scenario/extension-selection-matrix.ts";
import { extensionStartupFailure } from "./scenario/extension-startup-failure.ts";
import { extensionToolPruning } from "./scenario/extension-tool-pruning.ts";
import {
  extensionFreshVersionIsolationScenarios,
  extensionGitVersionIsolation,
  extensionNpmVersionIsolation,
  extensionRemoteIdentityScenarios,
} from "./scenario/extension-version-isolation.ts";
import { failure } from "./scenario/failure.ts";
import { fatalAutonomous } from "./scenario/fatal-autonomous.ts";
import { fatalInteractive } from "./scenario/fatal-interactive.ts";
import { focusPreservation } from "./scenario/focus-preservation.ts";
import { generalPurposeDefinition } from "./scenario/general-purpose-definition.ts";
import { globalAgentDefinition } from "./scenario/global-agent-definition.ts";
import { idleContinuation } from "./scenario/idle-continuation.ts";
import { inheritedAgentRenderer } from "./scenario/inherited-agent-renderer.ts";
import { inheritedAgentsSkills } from "./scenario/inherited-agents-skills.ts";
import { inheritedParentRequestRenderer } from "./scenario/inherited-parent-request-renderer.ts";
import { interactive } from "./scenario/interactive.ts";
import {
  largeLaunchAppend,
  largeLaunchTask,
} from "./scenario/large-launch-payload.ts";
import { lifecycle } from "./scenario/lifecycle.ts";
import { malformedAgentDefinition } from "./scenario/malformed-agent-definition.ts";
import {
  namedLiveAnswer,
  namedLiveSteer,
  namedStoppedAnswer,
  namedStoppedReopen,
} from "./scenario/named-agent-continuations.ts";
import { namedAgent } from "./scenario/named-agent.ts";
import { narrowWidgets } from "./scenario/narrow-widgets.ts";
import { navigationCancellation } from "./scenario/navigation-cancellation.ts";
import { outside } from "./scenario/outside.ts";
import {
  overriddenUnknownGlobalTool,
  overriddenValidChildTool,
} from "./scenario/overridden-tool-validation.ts";
import { parentResponsiveness } from "./scenario/parent-responsiveness.ts";
import { parent } from "./scenario/parent.ts";
import { pendingRequestClosure } from "./scenario/pending-request-closure.ts";
import {
  pendingRequestCancelled,
  pendingRequestCompleted,
  pendingRequestFailed,
} from "./scenario/pending-request-outcomes.ts";
import { persistentState } from "./scenario/persistent-state.ts";
import { programmaticContinuation } from "./scenario/programmatic-continuation.ts";
import { projectOverridesGlobalAgent } from "./scenario/project-overrides-global-agent.ts";
import {
  packageSkillSnapshot,
  warmPackageSnapshotScenarios,
} from "./scenario/resource-snapshot.ts";
import { resultExpansion } from "./scenario/result-expansion.ts";
import { resumePromotionRejection } from "./scenario/resume-promotion.ts";
import { skillDependencyReopen } from "./scenario/skill-dependency-snapshot.ts";
import {
  skillConflictScenarios,
  skillEdgeSelectionScenarios,
} from "./scenario/skill-edge-selection.ts";
import { freshSkillDiscoveryScenarios } from "./scenario/skill-fresh-discovery.ts";
import { staleResponse } from "./scenario/stale-response.ts";
import { staleTerminalResponse } from "./scenario/stale-terminal-response.ts";
import { stoppedReopen } from "./scenario/stopped-reopen.ts";
import { terminalDefaultFade } from "./scenario/terminal-default-fade.ts";
import { terminalTakeover } from "./scenario/terminal-takeover.ts";
import { terminatedToolReopen } from "./scenario/terminated-tool-reopen.ts";
import { threeConcurrentQuestions } from "./scenario/three-concurrent-questions.ts";
import { toolsListed } from "./scenario/tools-listed.ts";
import { unmarkedClosure } from "./scenario/unmarked-closure.ts";
import { widgetSpacing } from "./scenario/widget-spacing.ts";
import { windowPlacement } from "./scenario/window-placement.ts";
import { windowTitleFinalPaneClose } from "./scenario/window-title-final-pane-close.ts";
import { windowTitleNormalization } from "./scenario/window-title-normalization.ts";
import {
  windowTitleAutomaticRenameOff,
  windowTitleFormatOverride,
} from "./scenario/window-title-ownership.ts";
import { windowTitle } from "./scenario/window-title.ts";
import {
  wrapUpFailed,
  wrapUpInterrupted,
  wrapUpSuccess,
  wrapUpTextless,
} from "./scenario/wrap-up.ts";

export const scenarios: readonly Scenario[] = [
  outside,
  parent,
  child,
  diskSafeFirstPrompt,
  diskSafeColdLaunch,
  diskSafeLaunchRefusal,
  diskSafeWarmLaunch,
  toolsListed,
  lifecycle,
  interactive,
  askParent,
  threeConcurrentQuestions,
  persistentState,
  pendingRequestClosure,
  pendingRequestCompleted,
  pendingRequestFailed,
  pendingRequestCancelled,
  activeContinuation,
  activeParentEvent,
  activePromotionRejection,
  idleContinuation,
  stoppedReopen,
  terminatedToolReopen,
  explicitCompletion,
  extensionExecutesOnce,
  extensionAllChildTools,
  extensionChildToolReopen,
  extensionDirectRemoval,
  extensionToolPruning,
  ...extensionDirectOverlapScenarios,
  extensionFreshSettings,
  extensionReducedParentSnapshot,
  extensionStartupFailure,
  ...extensionPathSelectionScenarios,
  ...extensionSelectionMatrixScenarios,
  extensionNpmVersionIsolation,
  extensionGitVersionIsolation,
  ...extensionFreshVersionIsolationScenarios,
  ...extensionRemoteIdentityScenarios,
  ...warmPackageSnapshotScenarios,
  packageSkillSnapshot,
  ...extensionDependencyScenarios,
  inheritedDependencyReopen,
  skillDependencyReopen,
  ...extensionOfflineSelectionScenarios,
  extensionCanonicalAliasConflict,
  hiddenSkillExplicitSelection,
  largeLaunchAppend,
  largeLaunchTask,
  resumePromotionRejection,
  programmaticContinuation,
  failure,
  exhaustedProvider,
  fatalAutonomous,
  fatalInteractive,
  staleResponse,
  staleTerminalResponse,
  terminalTakeover,
  navigationCancellation,
  parentResponsiveness,
  unmarkedClosure,
  malformedAgentDefinition,
  namedAgent,
  namedLiveAnswer,
  namedLiveSteer,
  namedStoppedAnswer,
  namedStoppedReopen,
  descriptionOnlyNamedAgent,
  narrowWidgets,
  widgetSpacing,
  resultExpansion,
  terminalDefaultFade,
  inheritedAgentRenderer,
  inheritedParentRequestRenderer,
  focusPreservation,
  windowPlacement,
  windowTitle,
  windowTitleFinalPaneClose,
  windowTitleNormalization,
  windowTitleAutomaticRenameOff,
  windowTitleFormatOverride,
  wrapUpSuccess,
  wrapUpFailed,
  wrapUpInterrupted,
  wrapUpTextless,
  generalPurposeDefinition,
  globalAgentDefinition,
  projectOverridesGlobalAgent,
  emptyGeneralPurposeOmitted,
  emptyGeneralPurposeExplicit,
  inheritedAgentsSkills,
  ...freshSkillDiscoveryScenarios,
  ...skillEdgeSelectionScenarios,
  ...skillConflictScenarios,
  ...agentDefinitionOverlayScenarios,
  overriddenUnknownGlobalTool,
  overriddenValidChildTool,
  ...agentCollectionPolicyScenarios,
  ...invalidAgentDefinitionScenarios,
  generalPurposeTombstone,
  namedAgentTombstone,
  agentCatalogRefresh,
  agentCallOverridePriority,
  agentResumePermissionsImmutable,
];

const scenariosByName = new Map(
  scenarios.map((scenario) => [scenario.name, scenario]),
);

export function scenarioByName(name: string): Scenario | undefined {
  return scenariosByName.get(name);
}
