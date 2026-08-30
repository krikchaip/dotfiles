#!/usr/bin/env bun

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const MODEL =
  process.env.SIDE_QUESTS_PROMPT_MODEL ?? "antigravity/gemini-3.6-flash-medium";
const MODEL_ID = MODEL.split("/").at(-1) ?? MODEL;
const POLL_MS = 100;
const TIMEOUT_MS = 60_000;
const COMPLETION_ATTEMPTS = 10;
const REQUIRED_COMPLETIONS = 9;

const packageExtension = resolve(import.meta.dir, "../../index.ts");
const agentFixture = resolve(import.meta.dir, "fixture/capture-agent-call.ts");
const completionFixture = resolve(
  import.meta.dir,
  "fixture/capture-subagent-done.ts",
);

type Json = Readonly<Record<string, unknown>>;

type PromptCase = Readonly<{
  extensions: readonly string[];
  name: string;
  outputEnvironment: string;
  prompt: string;
}>;

type AgentCase = PromptCase &
  Readonly<{
    verify(call: Json): void;
  }>;

const agentCases: readonly AgentCase[] = [
  {
    extensions: [packageExtension, agentFixture],
    name: "continuity-omits-inherit-context",
    outputEnvironment: "SIDE_QUESTS_AGENT_CALL_PATH",
    prompt:
      "Use Agent now to delegate an implementation branch. The child needs the normal context from our current conversation. Do not perform the branch yourself. Ask the child to inspect the project and propose the next implementation step.",
    verify(call) {
      assert(
        !("inherit_context" in call),
        `Expected inherit_context to be omitted, got ${JSON.stringify(call)}.`,
      );
    },
  },
  {
    extensions: [packageExtension, agentFixture],
    name: "isolation-disables-inherit-context",
    outputEnvironment: "SIDE_QUESTS_AGENT_CALL_PATH",
    prompt:
      "Use Agent now to delegate an independent adversarial review. The reviewer must not receive or be biased by our current conversation. Do not perform the review yourself. Ask the child to challenge the current design assumptions.",
    verify(call) {
      assert(
        call.inherit_context === false,
        `Expected inherit_context: false, got ${JSON.stringify(call)}.`,
      );
    },
  },
];

const completionCase: PromptCase = {
  extensions: [completionFixture],
  name: "autonomous-completion-protocol",
  outputEnvironment: "SIDE_QUESTS_SUBAGENT_DONE_PATH",
  prompt:
    "The assigned side quest is complete. Prepare a thorough parent-facing handoff from these verified observations: configuration loaded correctly, 163 unit tests passed, 41 real-tmux end-to-end scenarios passed, no blockers remain, and no uncertainty remains. Include the outcome, evidence, blockers, and remaining uncertainty.",
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function quote(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

async function execute(
  command: string[],
  allowFailure = false,
): Promise<string> {
  const child = Bun.spawn(command, { stderr: "pipe", stdout: "pipe" });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  if (status !== 0 && !allowFailure)
    throw new Error(
      `Command failed (${status}): ${command.join(" ")}\n${stderr || stdout}`,
    );

  return stdout;
}

async function waitUntil(
  description: string,
  predicate: () => boolean | Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await predicate()) return;
    await Bun.sleep(POLL_MS);
  }

  throw new Error(
    `Timed out after ${TIMEOUT_MS}ms waiting for ${description}.`,
  );
}

async function runCase(testCase: PromptCase, attempt = 1): Promise<Json> {
  const runDirectory = mkdtempSync(
    join(tmpdir(), `side-quests-model-${testCase.name}-`),
  );
  const socket = join(
    tmpdir(),
    `sqm-${process.pid}-${testCase.name.slice(0, 1)}-${attempt}.sock`,
  );
  const resultPath = join(runDirectory, "model-decision.json");
  const launchPath = join(runDirectory, "launch.sh");
  const workDirectory = join(runDirectory, "cwd");
  const sessionName = `sq-model-${process.pid}-${attempt}`;
  const extensionArguments = testCase.extensions
    .flatMap((extension) => ["-e", quote(extension)])
    .join(" ");
  let paneId = "";

  rmSync(socket, { force: true });
  mkdirSync(workDirectory);
  writeFileSync(
    launchPath,
    [
      "#!/bin/sh",
      "set -eu",
      `export ${testCase.outputEnvironment}=${quote(resultPath)}`,
      "export PI_TELEMETRY=0",
      `exec pi --no-session --no-context-files --no-prompt-templates --no-skills --no-themes --no-extensions --no-builtin-tools --model ${quote(MODEL)} ${extensionArguments}`,
      "",
    ].join("\n"),
  );
  chmodSync(launchPath, 0o700);

  try {
    paneId = (
      await execute([
        "tmux",
        "-S",
        socket,
        "-f",
        "/dev/null",
        "new-session",
        "-d",
        "-P",
        "-F",
        "#{pane_id}",
        "-s",
        sessionName,
        "-x",
        "100",
        "-y",
        "30",
        "-c",
        workDirectory,
        launchPath,
      ])
    ).trim();

    await waitUntil("Pi startup", async () =>
      (
        await execute(
          ["tmux", "-S", socket, "capture-pane", "-p", "-J", "-t", paneId],
          true,
        )
      ).includes(MODEL_ID),
    );

    await execute([
      "tmux",
      "-S",
      socket,
      "send-keys",
      "-l",
      "-t",
      paneId,
      testCase.prompt,
    ]);
    await execute(["tmux", "-S", socket, "send-keys", "-t", paneId, "Enter"]);

    await waitUntil("a model decision", () => existsSync(resultPath));

    return JSON.parse(readFileSync(resultPath, "utf8")) as Json;
  } catch (cause) {
    const pane = paneId
      ? await execute(
          [
            "tmux",
            "-S",
            socket,
            "capture-pane",
            "-p",
            "-J",
            "-t",
            paneId,
            "-S",
            "-",
          ],
          true,
        )
      : "";
    throw new Error(
      `${testCase.name} attempt ${attempt} failed with ${MODEL}: ${cause instanceof Error ? cause.message : String(cause)}\n\nPane:\n${pane}`,
    );
  } finally {
    await execute(["tmux", "-S", socket, "kill-server"], true);
    rmSync(socket, { force: true });
    rmSync(runDirectory, { force: true, recursive: true });
  }
}

function completionCompliance(
  decision: Json,
): { compliant: true } | { compliant: false; reason: string } {
  if (decision.outcome !== "tool")
    return {
      compliant: false,
      reason: "model ended with a normal assistant response",
    };

  const input = decision.input;
  if (!input || typeof input !== "object")
    return {
      compliant: false,
      reason: "subagent_done input was not an object",
    };

  const result = (input as Record<string, unknown>).result;
  if (typeof result !== "string" || result.trim().length < 80)
    return {
      compliant: false,
      reason: "subagent_done.result was not a complete handoff",
    };

  const content = Array.isArray(decision.assistantContent)
    ? decision.assistantContent
    : [];
  const parts = content.filter(
    (part): part is Record<string, unknown> =>
      typeof part === "object" && part !== null,
  );
  const text = parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text).trim())
    .filter(Boolean);
  const toolCalls = parts.filter((part) => part.type === "toolCall");

  if (text.length > 0)
    return {
      compliant: false,
      reason: "assistant text accompanied the final tool call",
    };

  if (toolCalls.length !== 1 || toolCalls[0]?.name !== "subagent_done")
    return {
      compliant: false,
      reason: `final response contained ${toolCalls.length} tool calls`,
    };

  return { compliant: true };
}

for (const testCase of agentCases) {
  process.stdout.write(`MODEL ${testCase.name} ... `);
  const call = await runCase(testCase);
  assert(typeof call.prompt === "string", "Agent.prompt was not a string.");
  assert(
    typeof call.description === "string",
    "Agent.description was not a string.",
  );
  assert(!("resume" in call), "A new launch unexpectedly included resume.");
  testCase.verify(call);
  process.stdout.write("PASS\n");
}

assert(
  !completionCase.prompt.includes("subagent_done") &&
    !completionCase.prompt.toLowerCase().includes("tool call"),
  "The autonomous completion prompt must not explicitly prescribe the mechanism.",
);

let compliantCompletions = 0;
const failures: string[] = [];

for (let attempt = 1; attempt <= COMPLETION_ATTEMPTS; attempt += 1) {
  process.stdout.write(
    `MODEL ${completionCase.name} ${attempt}/${COMPLETION_ATTEMPTS} ... `,
  );
  const decision = await runCase(completionCase, attempt);
  const compliance = completionCompliance(decision);

  if (compliance.compliant) {
    compliantCompletions += 1;
    process.stdout.write("PASS\n");
  } else {
    failures.push(`${attempt}: ${compliance.reason}`);
    process.stdout.write(`FAIL ${compliance.reason}\n`);
  }
}

assert(
  compliantCompletions >= REQUIRED_COMPLETIONS,
  `Completion reliability was ${compliantCompletions}/${COMPLETION_ATTEMPTS}; required ${REQUIRED_COMPLETIONS}/${COMPLETION_ATTEMPTS}. Failures: ${failures.join("; ")}`,
);

console.log(
  `PASS prompt behavior (${MODEL}): autonomous completion ${compliantCompletions}/${COMPLETION_ATTEMPTS}`,
);
