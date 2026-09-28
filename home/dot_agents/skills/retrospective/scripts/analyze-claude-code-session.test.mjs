import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  analyzeClaudeCodeSession,
  parseTranscriptSnapshot,
  resolveClaudeCodeSession,
  writeAnalysis,
} from "./analyze-claude-code-session.mjs";

const png = (text) => ({
  type: "image",
  source: {
    type: "base64",
    media_type: "image/png",
    data: Buffer.from(text).toString("base64"),
  },
});

function jsonl(entries, finalNewline = true) {
  const text = entries.map((entry) => JSON.stringify(entry)).join("\n");
  return finalNewline ? `${text}\n` : text;
}

function entry(uuid, parentUuid, type, fields = {}) {
  return {
    parentUuid,
    isSidechain: false,
    type,
    uuid,
    timestamp: `2026-01-01T00:00:${String(uuid).slice(-2).padStart(2, "0")}.000Z`,
    sessionId: "fixture",
    cwd: "/work/project",
    version: "2.1.283",
    ...fields,
  };
}

function user(uuid, parentUuid, content, fields = {}) {
  return entry(uuid, parentUuid, "user", {
    message: { role: "user", content },
    origin: { kind: "human" },
    ...fields,
  });
}

function assistant(uuid, parentUuid, messageId, content, fields = {}) {
  return entry(uuid, parentUuid, "assistant", {
    message: {
      id: messageId,
      role: "assistant",
      model: "claude-opus-5-5",
      content,
      stop_reason: "tool_use",
    },
    ...fields,
  });
}

function toolResult(uuid, parentUuid, toolUseId, content, fields = {}) {
  return entry(uuid, parentUuid, "user", {
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content,
          is_error: false,
        },
      ],
    },
    toolUseResult: {},
    sourceToolAssistantUUID: parentUuid,
    ...fields,
  });
}

function attachment(uuid, parentUuid, value) {
  return entry(uuid, parentUuid, "attachment", { attachment: value });
}

function makeSession(root, project, id, entries) {
  const directory = join(root, project);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${id}.jsonl`);
  writeFileSync(path, jsonl(entries));
  return path;
}

test("bridges compaction, merges split assistant entries, keeps parallel tool results, and drops private material", () => {
  const root = mkdtempSync(join(tmpdir(), "retrospective-claude-code-"));
  const path = makeSession(root, "-work-project", "session-main", [
    attachment("at01", null, {
      type: "instructions",
      files: [
        { path: "/home/me/.claude/CLAUDE.md", type: "User" },
        { path: "/work/project/AGENTS.md", type: "Project" },
      ],
    }),
    entry("sy02", "at01", "system", {
      subtype: "local_command",
      content: "<command-name>/model</command-name>",
    }),
    user("us03", "sy02", [
      { type: "text", text: "before compaction" },
      png("user image"),
    ]),
    assistant("as04", "us03", "msg-1", [
      { type: "thinking", thinking: "private reasoning", signature: "sig" },
    ]),
    assistant("as05", "as04", "msg-1", [
      { type: "text", text: "reading both" },
    ]),
    assistant("as06", "as05", "msg-1", [
      {
        type: "tool_use",
        id: "call-a",
        name: "Read",
        input: { file_path: "a" },
      },
    ]),
    assistant("as07", "as06", "msg-1", [
      {
        type: "tool_use",
        id: "call-b",
        name: "Read",
        input: { file_path: "b" },
      },
    ]),
    toolResult("tr08", "as06", "call-a", [
      { type: "text", text: "result a" },
      png("tool image"),
    ]),
    toolResult("tr09", "as07", "call-b", "result b"),
    user("us10", "tr09", "load skill", { isMeta: true, origin: undefined }),
    entry("sy11", null, "system", {
      subtype: "compact_boundary",
      logicalParentUuid: "us10",
      content: "Conversation compacted",
    }),
    user("us12", "sy11", "replacement summary", {
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
      origin: undefined,
    }),
    attachment("at13", "us12", {
      type: "queued_command",
      prompt: "queued while busy",
      commandMode: "prompt",
      origin: { kind: "human" },
    }),
    attachment("at14", "at13", {
      type: "queued_command",
      prompt: "<task-notification>done</task-notification>",
      commandMode: "task-notification",
    }),
    attachment("at15", "at14", {
      type: "nested_memory",
      path: "/work/project/sub/CLAUDE.md",
    }),
    user("us16", "at15", "after compaction"),
    assistant("as17", "us16", "msg-2", [{ type: "text", text: "after reply" }]),
    {
      type: "last-prompt",
      lastPrompt: "after compaction",
      leafUuid: "as17",
      sessionId: "fixture",
    },
    {
      type: "custom-title",
      customTitle: "Fixture title",
      sessionId: "fixture",
    },
  ]);

  const result = analyzeClaudeCodeSession("session-main", {
    projectRoots: [root],
    env: { CLAUDE_CODE_SESSION_ID: "session-main" },
  });

  assert.deepEqual(
    result.messages.map(({ position, role, entryId }) => [
      position,
      role,
      entryId,
    ]),
    [
      [1, "command", "sy02"],
      [2, "user", "us03"],
      [3, "assistant", "as04"],
      [4, "toolResult", "tr08"],
      [5, "toolResult", "tr09"],
      [6, "harness", "us10"],
      [7, "user", "at13"],
      [8, "harness", "at14"],
      [9, "user", "us16"],
      [10, "assistant", "as17"],
    ],
  );
  const [, prompt, reply, resultA, resultB, meta, queued] = result.messages;
  assert.equal(prompt.text, "before compaction");
  assert.deepEqual(reply.entryIds, ["as04", "as05", "as06", "as07"]);
  assert.equal(reply.text, "reading both");
  assert.deepEqual(
    reply.toolCalls.map(({ id }) => id),
    ["call-a", "call-b"],
  );
  assert.equal(resultA.toolName, "Read");
  assert.equal(resultA.text, "result a");
  assert.equal(resultB.text, "result b");
  assert.equal(meta.source, "meta");
  assert.equal(queued.source, "queued_command:prompt");
  assert.doesNotMatch(
    JSON.stringify(result.messages),
    /private reasoning|replacement summary|"sig"/,
  );

  assert.equal(result.metadata.harness, "claude-code");
  assert.equal(result.metadata.sessionName, "Fixture title");
  assert.equal(result.metadata.isCurrentSession, true);
  assert.equal(result.metadata.compactionCount, 1);
  assert.equal(result.metadata.unbridgedCompaction, undefined);
  assert.equal(result.metadata.abandonedMessageCount, 0);
  assert.deepEqual(
    result.metadata.contextFiles.map(({ path }) => path),
    [
      "/home/me/.claude/CLAUDE.md",
      "/work/project/AGENTS.md",
      "/work/project/sub/CLAUDE.md",
    ],
  );
  assert.equal(result.metadata.sourcePath, realpathSync(path));

  const output = join(root, "analysis.jsonl");
  const metadata = writeAnalysis(result, output);
  const records = readFileSync(output, "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(statSync(output).mode & 0o777, 0o600);
  assert.equal(statSync(metadata.assetsDirectory).mode & 0o777, 0o700);
  assert.equal(readdirSync(metadata.assetsDirectory).length, 2);
  assert.equal(records[0].imageCount, 2);
  assert.equal(records[2].images[0].data, undefined);
  assert.equal(readFileSync(records[2].images[0].path, "utf8"), "user image");
  assert.equal(readFileSync(records[4].images[0].path, "utf8"), "tool image");
});

test("follows the newest message after a rewind and honors a later last-prompt branch switch", () => {
  const root = mkdtempSync(join(tmpdir(), "retrospective-claude-code-"));
  const base = [
    user("us01", null, "first"),
    assistant("as02", "us01", "msg-1", [{ type: "text", text: "first reply" }]),
    user("us03", "as02", "abandoned prompt"),
    assistant("as04", "us03", "msg-2", [
      { type: "text", text: "abandoned reply" },
    ]),
    user("us05", "as02", "rewound prompt"),
    assistant("as06", "us05", "msg-3", [
      { type: "text", text: "rewound reply" },
    ]),
  ];
  makeSession(root, "-work-project", "rewind-latest", base);
  makeSession(root, "-work-project", "rewind-pointer", [
    ...base,
    {
      type: "last-prompt",
      lastPrompt: "abandoned prompt",
      leafUuid: "as04",
      sessionId: "fixture",
    },
  ]);

  const latest = analyzeClaudeCodeSession("rewind-latest", {
    projectRoots: [root],
    env: {},
  });
  assert.deepEqual(
    latest.messages.map(({ text }) => text),
    ["first", "first reply", "rewound prompt", "rewound reply"],
  );
  assert.equal(latest.metadata.leafSource, "latest-message");
  assert.equal(latest.metadata.abandonedMessageCount, 2);
  assert.equal(latest.metadata.isCurrentSession, null);

  const pointer = analyzeClaudeCodeSession("rewind-pointer", {
    projectRoots: [root],
    env: {},
  });
  assert.deepEqual(
    pointer.messages.map(({ text }) => text),
    ["first", "first reply", "abandoned prompt", "abandoned reply"],
  );
  assert.equal(pointer.metadata.leafSource, "last-prompt");
});

test("keeps a forked session whose compaction parent was not copied", () => {
  const root = mkdtempSync(join(tmpdir(), "retrospective-claude-code-"));
  const forkedFrom = { sessionId: "source-session", messageUuid: "x" };
  makeSession(root, "-work-project", "forked", [
    entry("sy01", null, "system", {
      subtype: "compact_boundary",
      logicalParentUuid: "us03",
      forkedFrom,
    }),
    user("us02", "sy01", "summary", {
      isCompactSummary: true,
      origin: undefined,
      forkedFrom,
    }),
    user("us03", "us02", "preserved prompt", { forkedFrom }),
    assistant("as04", "us03", "msg-1", [{ type: "text", text: "fork reply" }]),
  ]);

  const result = analyzeClaudeCodeSession("forked", {
    projectRoots: [root],
    env: {},
  });
  assert.deepEqual(
    result.messages.map(({ text }) => text),
    ["preserved prompt", "fork reply"],
  );
  assert.deepEqual(result.metadata.unbridgedCompaction, {
    boundaryEntryId: "sy01",
    logicalParentUuid: "us03",
  });
  assert.deepEqual(result.metadata.forkedFromSessionIds, ["source-session"]);
});

test("resolves an exact ID before prefixes, then a session title, and rejects ambiguity", () => {
  const root = mkdtempSync(join(tmpdir(), "retrospective-claude-code-"));
  const exactPath = makeSession(root, "-one", "abc", [
    user("us01", null, "exact"),
  ]);
  makeSession(root, "-two", "abcdef-one", [user("us01", null, "one")]);
  const titledPath = makeSession(root, "-three", "abcdef-two", [
    user("us01", null, "two"),
    { type: "ai-title", aiTitle: "Generated name", sessionId: "abcdef-two" },
    {
      type: "custom-title",
      customTitle: "Named session",
      sessionId: "abcdef-two",
    },
  ]);

  assert.equal(
    resolveClaudeCodeSession("abc", { projectRoots: [root] }),
    realpathSync(exactPath),
  );
  assert.equal(
    resolveClaudeCodeSession("Named session", { projectRoots: [root] }),
    realpathSync(titledPath),
  );
  assert.equal(
    resolveClaudeCodeSession(titledPath, { projectRoots: [] }),
    realpathSync(titledPath),
  );
  assert.throws(
    () => resolveClaudeCodeSession("abcdef", { projectRoots: [root] }),
    /Ambiguous Claude Code session identifier/,
  );
  assert.throws(
    () => resolveClaudeCodeSession("Generated name", { projectRoots: [root] }),
    /session not found/,
  );
});

test("rejects malformed lines, an in-progress tail, and a broken parent chain", () => {
  const valid = parseTranscriptSnapshot(
    Buffer.from(jsonl([user("us01", null, "complete")], false)),
    "valid.jsonl",
  );
  assert.equal(valid.length, 1);

  assert.throws(
    () =>
      parseTranscriptSnapshot(
        Buffer.from(`${jsonl([user("us01", null, "complete")])}{"type":"user"`),
        "partial.jsonl",
      ),
    /Incomplete final JSON record/,
  );
  assert.throws(
    () =>
      parseTranscriptSnapshot(
        Buffer.from(`${jsonl([user("us01", null, "complete")])}not-json\n`),
        "bad.jsonl",
      ),
    /Malformed JSON on completed line 2/,
  );

  const root = mkdtempSync(join(tmpdir(), "retrospective-claude-code-"));
  makeSession(root, "-work-project", "broken", [
    user("us01", "missing", "orphan"),
  ]);
  assert.throws(
    () => analyzeClaudeCodeSession("broken", { projectRoots: [root], env: {} }),
    /Broken Claude Code parent chain/,
  );
});
