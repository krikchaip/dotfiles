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
import { askParent } from "./scenario/ask-parent.ts";
import { child } from "./scenario/child.ts";
import { descriptionOnlyNamedAgent } from "./scenario/description-only-named-agent.ts";
import {
  emptyGeneralPurposeExplicit,
  emptyGeneralPurposeOmitted,
} from "./scenario/empty-general-purpose.ts";
import { exhaustedProvider } from "./scenario/exhausted-provider.ts";
import { explicitCompletion } from "./scenario/explicit-completion.ts";
import { failure } from "./scenario/failure.ts";
import { fatalAutonomous } from "./scenario/fatal-autonomous.ts";
import { fatalInteractive } from "./scenario/fatal-interactive.ts";
import { focusPreservation } from "./scenario/focus-preservation.ts";
import { generalPurposeDefinition } from "./scenario/general-purpose-definition.ts";
import { globalAgentDefinition } from "./scenario/global-agent-definition.ts";
import { idleContinuation } from "./scenario/idle-continuation.ts";
import { inheritedAgentsSkills } from "./scenario/inherited-agents-skills.ts";
import { inheritedAgentRenderer } from "./scenario/inherited-agent-renderer.ts";
import { inheritedParentRequestRenderer } from "./scenario/inherited-parent-request-renderer.ts";
import { interactive } from "./scenario/interactive.ts";
import { lifecycle } from "./scenario/lifecycle.ts";
import { malformedAgentDefinition } from "./scenario/malformed-agent-definition.ts";
import { namedAgent } from "./scenario/named-agent.ts";
import { narrowWidgets } from "./scenario/narrow-widgets.ts";
import { navigationCancellation } from "./scenario/navigation-cancellation.ts";
import { outside } from "./scenario/outside.ts";
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
import { projectShadowsGlobalAgent } from "./scenario/project-shadows-global-agent.ts";
import { resultExpansion } from "./scenario/result-expansion.ts";
import { resumePromotionRejection } from "./scenario/resume-promotion.ts";
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
  projectShadowsGlobalAgent,
  emptyGeneralPurposeOmitted,
  emptyGeneralPurposeExplicit,
  inheritedAgentsSkills,
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
