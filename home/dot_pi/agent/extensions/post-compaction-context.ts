/**
 * Post-compaction context usage fix for Pi.
 *
 * After `/compact`, Pi can briefly report unknown context usage until the next
 * assistant response. Patch AgentSession.getContextUsage to return a local
 * estimate for that post-compaction gap, so footers keep showing a number.
 *
 * Usage: enable this extension; no settings required.
 */

import {
  AgentSession,
  calculateContextTokens,
  estimateTokens,
  getLatestCompactionEntry,
  type CompactionEntry,
  type ExtensionAPI,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";

type AgentMessage = Parameters<typeof estimateTokens>[0];
type Usage = Parameters<typeof calculateContextTokens>[0];

type AssistantWithUsage = AgentMessage & {
  role: "assistant";
  stopReason?: string;
  usage: Usage;
};

type PatchState = {
  originalGetContextUsage: AgentSession["getContextUsage"];
};

type PatchablePrototype = typeof AgentSession.prototype &
  Record<symbol, PatchState | undefined>;

const EXTENSION_NAME = "post-compaction-context";
const PATCH_STATE = Symbol.for(`${EXTENSION_NAME}.patch`);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAssistantWithUsage(
  message: AgentMessage,
): message is AssistantWithUsage {
  return (
    isRecord(message) && message.role === "assistant" && isRecord(message.usage)
  );
}

function estimateMessagesTokens(messages: AgentMessage[]): number {
  let tokens = 0;
  for (const message of messages) tokens += estimateTokens(message);
  return tokens;
}

function hasPostCompactionUsage(
  entries: SessionEntry[],
  latestCompaction: CompactionEntry,
): boolean {
  const compactionIndex = entries.lastIndexOf(latestCompaction);
  if (compactionIndex < 0) return false;

  for (let i = entries.length - 1; i > compactionIndex; i--) {
    const entry = entries[i];
    if (entry.type !== "message" || !isAssistantWithUsage(entry.message)) {
      continue;
    }

    if (
      entry.message.stopReason === "aborted" ||
      entry.message.stopReason === "error"
    ) {
      continue;
    }

    if (calculateContextTokens(entry.message.usage) > 0) return true;
  }

  return false;
}

function patchAgentSessionContextUsage() {
  const prototype = AgentSession.prototype as PatchablePrototype;
  if (prototype[PATCH_STATE]) return;

  const originalGetContextUsage = prototype.getContextUsage;
  prototype[PATCH_STATE] = { originalGetContextUsage };

  prototype.getContextUsage = function patchedGetContextUsage(
    this: AgentSession,
  ) {
    const contextWindow = this.model?.contextWindow ?? 0;
    if (contextWindow <= 0) return originalGetContextUsage.call(this);

    const branchEntries = this.sessionManager.getBranch();
    const latestCompaction = getLatestCompactionEntry(branchEntries);
    if (
      !latestCompaction ||
      hasPostCompactionUsage(branchEntries, latestCompaction)
    ) {
      return originalGetContextUsage.call(this);
    }

    const tokens = estimateMessagesTokens(this.messages);
    return {
      tokens,
      contextWindow,
      percent: (tokens / contextWindow) * 100,
    };
  };
}

export default function (_pi: ExtensionAPI) {
  try {
    patchAgentSessionContextUsage();
  } catch (error) {
    console.error(
      `${EXTENSION_NAME}: failed to patch AgentSession.getContextUsage`,
      error,
    );
  }
}
