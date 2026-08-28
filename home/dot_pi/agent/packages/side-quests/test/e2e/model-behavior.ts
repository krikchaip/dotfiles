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

type AgentCall = Readonly<Record<string, unknown>>;

type BehaviorCase = Readonly<{
  name: string;
  prompt: string;
  verify(call: AgentCall): void;
}>;

const cases: readonly BehaviorCase[] = [
  {
    name: "continuity-omits-inherit-context",
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
    name: "isolation-disables-inherit-context",
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

async function runCase(testCase: BehaviorCase): Promise<void> {
  const runDirectory = mkdtempSync(
    join(tmpdir(), `side-quests-model-${testCase.name}-`),
  );
  const socket = join(
    tmpdir(),
    `sqm-${process.pid}-${testCase.name.slice(0, 1)}.sock`,
  );
  const resultPath = join(runDirectory, "agent-call.json");
  const launchPath = join(runDirectory, "launch.sh");
  const workDirectory = join(runDirectory, "cwd");
  const extension = resolve(import.meta.dir, "../../index.ts");
  const fixture = resolve(import.meta.dir, "fixture/capture-agent-call.ts");
  const sessionName = `sq-model-${process.pid}`;
  let paneId = "";

  rmSync(socket, { force: true });
  mkdirSync(workDirectory);
  writeFileSync(
    launchPath,
    [
      "#!/bin/sh",
      "set -eu",
      `export SIDE_QUESTS_AGENT_CALL_PATH=${quote(resultPath)}`,
      "export PI_TELEMETRY=0",
      `exec pi --no-session --no-context-files --no-prompt-templates --no-skills --no-themes --no-extensions --no-builtin-tools --model ${quote(MODEL)} -e ${quote(extension)} -e ${quote(fixture)}`,
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

    await waitUntil("an Agent tool call", () => existsSync(resultPath));

    const call = JSON.parse(readFileSync(resultPath, "utf8")) as AgentCall;
    assert(typeof call.prompt === "string", "Agent.prompt was not a string.");
    assert(
      typeof call.description === "string",
      "Agent.description was not a string.",
    );
    assert(!("resume" in call), "A new launch unexpectedly included resume.");
    testCase.verify(call);
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
      `${testCase.name} failed with ${MODEL}: ${cause instanceof Error ? cause.message : String(cause)}\n\nPane:\n${pane}`,
    );
  } finally {
    await execute(["tmux", "-S", socket, "kill-server"], true);
    rmSync(socket, { force: true });
    rmSync(runDirectory, { force: true, recursive: true });
  }
}

for (const testCase of cases) {
  process.stdout.write(`MODEL ${testCase.name} ... `);
  await runCase(testCase);
  process.stdout.write("PASS\n");
}

console.log(`PASS Agent prompt behavior (${MODEL})`);
