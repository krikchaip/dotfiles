import { activeContinuation } from "./scenario/active-continuation.ts";
import { activeParentEvent } from "./scenario/active-parent-event.ts";
import { activePromotionRejection } from "./scenario/active-promotion.ts";
import { askParent } from "./scenario/ask-parent.ts";
import { child } from "./scenario/child.ts";
import { exhaustedProvider } from "./scenario/exhausted-provider.ts";
import { failure } from "./scenario/failure.ts";
import { fatalAutonomous } from "./scenario/fatal-autonomous.ts";
import { fatalInteractive } from "./scenario/fatal-interactive.ts";
import { focusPreservation } from "./scenario/focus-preservation.ts";
import { idleContinuation } from "./scenario/idle-continuation.ts";
import { inheritedAgentRenderer } from "./scenario/inherited-agent-renderer.ts";
import { inheritedParentRequestRenderer } from "./scenario/inherited-parent-request-renderer.ts";
import { interactive } from "./scenario/interactive.ts";
import { lifecycle } from "./scenario/lifecycle.ts";
import { narrowWidgets } from "./scenario/narrow-widgets.ts";
import { navigationCancellation } from "./scenario/navigation-cancellation.ts";
import { outside } from "./scenario/outside.ts";
import { parent } from "./scenario/parent.ts";
import { pendingRequestClosure } from "./scenario/pending-request-closure.ts";
import {
  pendingRequestCancelled,
  pendingRequestCompleted,
  pendingRequestFailed,
} from "./scenario/pending-request-outcomes.ts";
import { persistentState } from "./scenario/persistent-state.ts";
import { programmaticContinuation } from "./scenario/programmatic-continuation.ts";
import { resultExpansion } from "./scenario/result-expansion.ts";
import { resumePromotionRejection } from "./scenario/resume-promotion.ts";
import { staleResponse } from "./scenario/stale-response.ts";
import { staleTerminalResponse } from "./scenario/stale-terminal-response.ts";
import { stoppedReopen } from "./scenario/stopped-reopen.ts";
import { terminalTakeover } from "./scenario/terminal-takeover.ts";
import { terminatedToolReopen } from "./scenario/terminated-tool-reopen.ts";
import { threeConcurrentQuestions } from "./scenario/three-concurrent-questions.ts";
import { toolsListed } from "./scenario/tools-listed.ts";
import { unmarkedClosure } from "./scenario/unmarked-closure.ts";
import { widgetSpacing } from "./scenario/widget-spacing.ts";
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
  unmarkedClosure,
  narrowWidgets,
  widgetSpacing,
  resultExpansion,
  inheritedAgentRenderer,
  inheritedParentRequestRenderer,
  focusPreservation,
  wrapUpSuccess,
  wrapUpFailed,
  wrapUpInterrupted,
  wrapUpTextless,
];

const scenariosByName = new Map(
  scenarios.map((scenario) => [scenario.name, scenario]),
);

export function scenarioByName(name: string): Scenario | undefined {
  return scenariosByName.get(name);
}
