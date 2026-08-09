import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";

import { JsonStore } from "../../store/json.ts";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0))
    rmSync(root, { force: true, recursive: true });
});

function temporaryPath(name = "record.json"): string {
  const root = mkdtempSync(join(tmpdir(), "side-quests-json-"));
  temporaryRoots.push(root);
  return join(root, "private", name);
}

test("writes private JSON atomically and replaces the prior value", () => {
  const path = temporaryPath();

  JsonStore.write(path, { sequence: 1 });
  JsonStore.write(path, { sequence: 2 });

  expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(readFileSync(path, "utf8")).toBe('{"sequence":2}\n');
  expect(readdirSync(dirname(path))).toEqual(["record.json"]);
});

test("writes ordered newline-terminated JSON Lines", () => {
  const path = temporaryPath("session.jsonl");

  JsonStore.writeLines(path, [{ id: "first" }, { id: "second" }]);

  expect(readFileSync(path, "utf8")).toBe('{"id":"first"}\n{"id":"second"}\n');
});

test.each(["not-json", "null", "[]", '"text"', "42"])(
  "returns no record for invalid JSON object input %s",
  (content) => {
    const path = temporaryPath();
    JsonStore.write(path, { valid: true });
    writeFileSync(path, content);

    expect(JsonStore.readRecord(path)).toBeUndefined();
  },
);

test("removes an existing file and tolerates repeated removal", () => {
  const path = temporaryPath();
  JsonStore.write(path, { active: true });

  JsonStore.remove(path);
  JsonStore.remove(path);

  expect(JsonStore.exists(path)).toBe(false);
});
