import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PiTuiHarness } from "./harness.ts";

export const root = resolve(import.meta.dir, "../../..");

export type JsonEntry = Record<string, unknown>;

export function isolatedHome(runDirectory: string, name: string): string {
  const home = join(runDirectory, `${name}-home`);
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  return home;
}

export function writeHomeSettings(
  home: string,
  settings: Record<string, unknown>,
): void {
  writeFileSync(
    join(home, ".pi", "agent", "settings.json"),
    `${JSON.stringify(settings)}\n`,
  );
}

export async function submitCommand(
  harness: PiTuiHarness,
  command: string,
): Promise<void> {
  await harness.sendLiteral(command);
  await Bun.sleep(120);
  await harness.sendKeys("Escape", "Enter");
}

export async function finish(harness: PiTuiHarness): Promise<void> {
  try {
    await harness.finish();
  } catch (error) {
    await harness.abort();
    throw error;
  }
}

export function sessionFiles(harness: PiTuiHarness): string[] {
  return [...new Bun.Glob("sessions/**/*.jsonl").scanSync(harness.stateDirectory)].map(
    (path) => join(harness.stateDirectory, path),
  );
}

export function readEntries(path: string): JsonEntry[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JsonEntry);
}

export function assertSimpleTurn(
  harness: PiTuiHarness,
  userText: string,
  assistantText: string,
): JsonEntry[] {
  const files = sessionFiles(harness);
  harness.assert(files.length === 1, `Expected one session JSONL, got ${files.length}`);
  const entries = readEntries(files[0]!);
  const messages = entries.filter((entry) => entry.type === "message");
  harness.assert(messages.length === 2, `Expected exactly two message entries, got ${messages.length}`);
  const serialized = messages.map((entry) => JSON.stringify(entry));
  harness.assert(serialized[0]?.includes(userText), "Persisted user message does not match");
  harness.assert(serialized[1]?.includes(assistantText), "Persisted assistant message does not match");
  harness.assert(
    entries.filter((entry) => entry.type === "compaction").length === 0,
    "Unexpected compaction entry persisted",
  );
  return entries;
}

export function messageEntry(
  id: string,
  parentId: string | null,
  role: "user" | "assistant",
  text: string,
  timestamp: number,
): JsonEntry {
  const message: JsonEntry = {
    role,
    content: [{ type: "text", text }],
    timestamp,
  };
  if (role === "assistant") {
    Object.assign(message, {
      api: "openai-completions",
      provider: "extension-e2e",
      model: "fake",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
    });
  }
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date(timestamp).toISOString(),
    message,
  };
}

export function writeJsonl(path: string, entries: JsonEntry[]): string {
  const raw = `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, raw);
  return raw;
}
