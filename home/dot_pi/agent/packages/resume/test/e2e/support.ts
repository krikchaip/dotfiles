import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const EXPECTED_VERSION = process.env.PI_E2E_EXPECT_VERSION ?? "0.84.4";

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function timestamp(second: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString();
}

export function writeSession(
  path: string,
  id: string,
  name: string,
  messages: string[],
  startSecond: number,
  parentSession?: string,
): string {
  mkdirSync(dirname(path), { recursive: true });
  const entries: Record<string, unknown>[] = [
    {
      type: "session",
      version: 3,
      id,
      timestamp: timestamp(startSecond),
      cwd: dirname(dirname(path)),
      ...(parentSession ? { parentSession } : {}),
    },
  ];
  let parentId: string | null = null;
  for (const [index, text] of messages.entries()) {
    const messageId = `${id}-message-${index + 1}`;
    const at = timestamp(startSecond + index + 1);
    entries.push({
      type: "message",
      id: messageId,
      parentId,
      timestamp: at,
      message: {
        role: "user",
        content: [{ type: "text", text }],
        timestamp: Date.parse(at),
      },
    });
    parentId = messageId;
  }
  entries.push({
    type: "session_info",
    id: `${id}-name`,
    parentId,
    timestamp: timestamp(startSecond + messages.length + 1),
    name,
  });
  const raw = `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  writeFileSync(path, raw);
  return raw;
}

export function readJsonLines(path: string): Record<string, unknown>[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function makeToolPath(runDirectory: string): string {
  const bin = join(runDirectory, "bin");
  const trash = join(bin, "trash");
  mkdirSync(bin, { recursive: true });
  writeFileSync(trash, "#!/bin/sh\nexit 1\n");
  chmodSync(trash, 0o700);
  return `${bin}:${process.env.PATH ?? ""}`;
}
