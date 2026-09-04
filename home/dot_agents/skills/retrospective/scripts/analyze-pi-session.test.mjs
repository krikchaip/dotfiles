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
  analyzePiSession,
  parseSessionSnapshot,
  resolvePiSession,
  writeAnalysis,
} from "./analyze-pi-session.mjs";

function jsonl(entries, finalNewline = true) {
  const text = entries.map((entry) => JSON.stringify(entry)).join("\n");
  return finalNewline ? `${text}\n` : text;
}

function message(id, parentId, role, content, extra = {}) {
  return {
    type: "message",
    id,
    parentId,
    timestamp: `2026-01-01T00:00:${id.slice(-2)}.000Z`,
    message: { role, content, timestamp: 0, ...extra },
  };
}

function makeSession(root, directory, id, entries) {
  const sessionDirectory = join(root, directory);
  mkdirSync(sessionDirectory, { recursive: true });
  const path = join(sessionDirectory, `${id}.jsonl`);
  writeFileSync(
    path,
    jsonl([
      {
        type: "session",
        version: 3,
        id,
        timestamp: "2026-01-01T00:00:00.000Z",
        cwd: `/work/${directory}`,
      },
      ...entries,
    ]),
  );
  return path;
}

test("keeps raw messages on both sides of compaction and selects only the active branch", () => {
  const root = mkdtempSync(join(tmpdir(), "retrospective-pi-"));
  makeSession(root, "project", "session-active", [
    message("u1", null, "user", [
      { type: "text", text: "before compaction" },
      { type: "image", mimeType: "image/png", data: Buffer.from("user image").toString("base64") },
    ]),
    message("a1", "u1", "assistant", [
      { type: "thinking", thinking: "private reasoning" },
      { type: "text", text: "before reply" },
    ]),
    {
      type: "compaction",
      id: "c1",
      parentId: "a1",
      timestamp: "2026-01-01T00:00:03.000Z",
      summary: "replacement summary",
      firstKeptEntryId: "a1",
      tokensBefore: 100,
    },
    message("ua", "c1", "user", "abandoned branch"),
    message("aa", "ua", "assistant", [{ type: "text", text: "abandoned reply" }]),
    message("u2", "c1", "user", "after compaction"),
    message("a2", "u2", "assistant", [
      { type: "text", text: "after reply" },
      { type: "toolCall", id: "call-1", name: "read", arguments: { path: "AGENTS.md" } },
    ]),
    message("t2", "a2", "toolResult", [
      { type: "text", text: "workspace rule" },
      { type: "image", mimeType: "image/jpeg", data: Buffer.from("tool image").toString("base64") },
    ], {
      toolCallId: "call-1",
      toolName: "read",
      isError: false,
    }),
  ]);

  const result = analyzePiSession("session-active", { sessionRoots: [root] });

  assert.equal(result.metadata.sessionId, "session-active");
  assert.deepEqual(
    result.messages.map(({ entryId, role }) => [entryId, role]),
    [
      ["u1", "user"],
      ["a1", "assistant"],
      ["u2", "user"],
      ["a2", "assistant"],
      ["t2", "toolResult"],
    ],
  );
  assert.equal(result.messages[0].text, "before compaction");
  assert.equal(result.messages[0].images[0].data, Buffer.from("user image").toString("base64"));
  assert.equal(result.messages[1].text, "before reply");
  assert.doesNotMatch(JSON.stringify(result), /private reasoning|replacement summary|abandoned/);
  assert.deepEqual(result.messages[3].toolCalls, [
    { id: "call-1", name: "read", arguments: { path: "AGENTS.md" } },
  ]);
  assert.equal(result.messages[4].text, "workspace rule");
  assert.equal(result.messages[4].images[0].data, Buffer.from("tool image").toString("base64"));
  assert.equal(result.metadata.compactionCount, 1);

  const output = join(root, "analysis.jsonl");
  const metadata = writeAnalysis(result, output);
  const records = readFileSync(output, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(statSync(output).mode & 0o777, 0o600);
  assert.equal(statSync(metadata.assetsDirectory).mode & 0o777, 0o700);
  assert.equal(readdirSync(metadata.assetsDirectory).length, 2);
  assert.equal(records[0].imageCount, 2);
  assert.equal(records[1].images[0].data, undefined);
  assert.equal(readFileSync(records[1].images[0].path, "utf8"), "user image");
  assert.equal(readFileSync(records[5].images[0].path, "utf8"), "tool image");
});

test("resolves an exact ID before prefixes and rejects ambiguous prefixes", () => {
  const root = mkdtempSync(join(tmpdir(), "retrospective-pi-"));
  const exactPath = makeSession(root, "one", "abc", [message("u1", null, "user", "exact")]);
  makeSession(root, "two", "abcdef-one", [message("u2", null, "user", "one")]);
  makeSession(root, "three", "abcdef-two", [message("u3", null, "user", "two")]);

  assert.equal(resolvePiSession("abc", { sessionRoots: [root] }), realpathSync(exactPath));
  assert.throws(
    () => resolvePiSession("abcdef", { sessionRoots: [root] }),
    /Ambiguous Pi session identifier/,
  );
});

test("accepts a valid unterminated final entry and rejects an in-progress tail", () => {
  const valid = parseSessionSnapshot(
    Buffer.from(
      jsonl(
        [
          { type: "session", version: 3, id: "valid", cwd: "/work" },
          message("u1", null, "user", "complete"),
        ],
        false,
      ),
    ),
    "valid.jsonl",
  );
  assert.equal(valid.entries.length, 1);

  assert.throws(
    () =>
      parseSessionSnapshot(
        Buffer.from(
          `${jsonl([{ type: "session", version: 3, id: "partial", cwd: "/work" }, message("u1", null, "user", "complete")])}{"type":"message"`,
        ),
        "partial.jsonl",
      ),
    /Incomplete final JSON record/,
  );
});

test("fails on malformed completed lines and broken active-branch parents", () => {
  assert.throws(
    () =>
      parseSessionSnapshot(
        Buffer.from('{"type":"session","version":3,"id":"bad","cwd":"/work"}\nnot-json\n'),
        "bad.jsonl",
      ),
    /Malformed JSON on completed line 2/,
  );

  const root = mkdtempSync(join(tmpdir(), "retrospective-pi-"));
  makeSession(root, "broken", "broken", [message("u1", "missing", "user", "orphan")]);
  assert.throws(
    () => analyzePiSession("broken", { sessionRoots: [root] }),
    /Broken Pi session parent chain/,
  );
});
