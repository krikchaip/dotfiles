import { configureBasicDelegation } from "../provider-support.ts";

const append = `APPEND START\n${"x".repeat(20_000)}\nAPPEND END`;
const prompt = `TASK START\n${"y".repeat(20_000)}\nTASK END`;

/**
 * Large inherited prompts cross the tmux launch boundary without truncation.
 */
export const largeLaunchAppend: Scenario = {
  name: "agent-large-launch-append",
  process: {
    arguments: ["--append-system-prompt", append],
    managed: true,
    positionalPrompt: "Delegate the large-prompt task.",
  },
  configureProvider(context) {
    configureBasicDelegation(context, { childSystemPromptIncludes: [append] });
  },
  async run(harness) {
    await harness.waitForWithout("SUBAGENT COMPLETED", "command too long");
  },
};

/**
 * Large multiline task text stays literal and starts exactly one child turn.
 */
export const largeLaunchTask: Scenario = {
  name: "agent-large-launch-task",
  process: { managed: true, positionalPrompt: "Delegate the large task." },
  configureProvider(context) {
    configureBasicDelegation(context, { prompt });
  },
  async run(harness) {
    await harness.waitForWithout("SUBAGENT COMPLETED", "command too long");
    await harness.waitForStoredText(JSON.stringify(prompt).slice(1, -1));
  },
};
