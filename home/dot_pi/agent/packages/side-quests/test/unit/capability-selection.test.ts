import { expect, test } from "vitest";

import {
  parseCapabilitySelection,
  resolveCapabilitySelection,
} from "../../capability-selection.ts";

test("parses boolean, uneven CSV, and YAML-list capability expressions", () => {
  expect(parseCapabilitySelection("tools", true)).toEqual({
    kind: "all",
  });
  expect(parseCapabilitySelection("tools", " +web_search , -bash ")).toEqual({
    kind: "parent-relative",
    entries: [
      { kind: "include", name: "web_search" },
      { kind: "exclude", name: "bash" },
    ],
  });
  expect(
    parseCapabilitySelection("extensions", ["npm:one", "npm:two"]),
  ).toEqual({
    kind: "fixed",
    entries: [
      { kind: "include", name: "npm:one" },
      { kind: "include", name: "npm:two" },
    ],
  });
});

test("treats false and an explicit empty list as no capability selection", () => {
  expect(parseCapabilitySelection("tools", false)).toEqual({ kind: "none" });
  expect(parseCapabilitySelection("skills", [])).toEqual({ kind: "none" });
});

test("rejects mixed, duplicate, conflicting, and malformed expressions", () => {
  for (const value of [
    ["read", "+grep"],
    ["+read", "-read"],
    ["read", "read"],
    "read, , grep",
    ["read", 3],
    "",
  ])
    expect(() => parseCapabilitySelection("tools", value)).toThrow();
});

test("parses skill preloads without permitting lazy and preload duplicates", () => {
  expect(
    parseCapabilitySelection("skills", ["+research", "-grilling", "++tdd"]),
  ).toEqual({
    kind: "parent-relative",
    entries: [
      { kind: "include", name: "research" },
      { kind: "exclude", name: "grilling" },
      { kind: "preload", name: "tdd" },
    ],
  });
  expect(parseCapabilitySelection("skills", ["++tdd"])).toEqual({
    kind: "fixed",
    entries: [{ kind: "preload", name: "tdd" }],
  });
  expect(() => parseCapabilitySelection("skills", ["tdd", "++tdd"])).toThrow();
  expect(() => parseCapabilitySelection("skills", ["+tdd", "++tdd"])).toThrow();
  expect(parseCapabilitySelection("skills", ["-tdd", "++tdd"])).toEqual({
    kind: "parent-relative",
    entries: [
      { kind: "exclude", name: "tdd" },
      { kind: "preload", name: "tdd" },
    ],
  });
});

test("rejects preloads outside skills and preserves a comma in a YAML-list item", () => {
  expect(() => parseCapabilitySelection("tools", ["++tdd"])).toThrow();
  expect(parseCapabilitySelection("extensions", ["/tmp/a,b/index.ts"])).toEqual(
    {
      kind: "fixed",
      entries: [{ kind: "include", name: "/tmp/a,b/index.ts" }],
    },
  );
});

test("resolves fixed and parent-relative selections by supplied identity", () => {
  const parentRelative = parseCapabilitySelection("extensions", [
    "+npm:example@2",
    "-npm:other",
  ]);
  const identity = (source: string) => source.replace(/@[^@]+$/, "");

  expect(parentRelative.kind).toBe("parent-relative");
  if (parentRelative.kind !== "parent-relative") return;

  expect(
    resolveCapabilitySelection(
      parentRelative,
      ["npm:example@1", "npm:other@1"],
      identity,
    ),
  ).toEqual(["npm:example@2"]);

  const fixed = parseCapabilitySelection("tools", ["read", "grep"]);
  expect(fixed.kind).toBe("fixed");
  if (fixed.kind !== "fixed") return;

  expect(resolveCapabilitySelection(fixed, ["bash"])).toEqual(["read", "grep"]);
});

test("rejects duplicate sources after a supplied identity normalizes them", () => {
  const fixed = parseCapabilitySelection("extensions", [
    "npm:example@1",
    "npm:example@2",
  ]);
  const identity = (source: string) => source.replace(/@[^@]+$/, "");

  expect(fixed.kind).toBe("fixed");
  if (fixed.kind !== "fixed") return;

  expect(() => resolveCapabilitySelection(fixed, [], identity)).toThrow(
    "repeats npm:example@2",
  );
});

test("rejects a parent-relative removal that does not match the parent set", () => {
  const parentRelative = parseCapabilitySelection("tools", ["-bash"]);

  expect(parentRelative.kind).toBe("parent-relative");
  if (parentRelative.kind !== "parent-relative") return;

  expect(() => resolveCapabilitySelection(parentRelative, ["read"])).toThrow(
    "cannot remove bash",
  );
});
