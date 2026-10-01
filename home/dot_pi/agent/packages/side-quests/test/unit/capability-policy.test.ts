import { expect, test } from "vitest";

import {
  resolveSkillCapabilities,
  resolveToolCapabilities,
} from "../../capability-policy.ts";
import { parseCapabilitySelection } from "../../capability-selection.ts";

test("resolves fixed, parent-relative, all, and empty normal tool sets", () => {
  const snapshot = {
    active: ["read", "bash", "Agent"],
    registered: ["read", "bash", "grep", "Agent", "ask_parent"],
  };

  expect(
    resolveToolCapabilities(
      parseCapabilitySelection("tools", ["grep", "Agent", "ask_parent"]),
      snapshot,
    ),
  ).toEqual(["grep"]);
  expect(
    resolveToolCapabilities(
      parseCapabilitySelection("tools", ["+grep", "-bash"]),
      snapshot,
    ),
  ).toEqual(["read", "grep"]);
  expect(
    resolveToolCapabilities(parseCapabilitySelection("tools", true), snapshot),
  ).toEqual(["read", "bash", "grep"]);
  expect(
    resolveToolCapabilities(parseCapabilitySelection("tools", []), snapshot),
  ).toEqual([]);
});

test("inherits parent tools on omission and defers child-extension tool validation only when requested", () => {
  const snapshot = {
    active: ["read", "bash"],
    registered: ["read", "bash"],
  };
  const selected = parseCapabilitySelection("tools", ["child_search"]);

  expect(resolveToolCapabilities(undefined, snapshot)).toEqual([
    "read",
    "bash",
  ]);
  expect(() => resolveToolCapabilities(selected, snapshot)).toThrow(
    "Unknown child tool: child_search",
  );
  expect(
    resolveToolCapabilities(selected, snapshot, { deferUnknown: true }),
  ).toEqual(["child_search"]);
});

test("resolves lazy and preloaded skills including hidden explicit skills", () => {
  const discovered = [
    { name: "research", modelInvocable: true },
    { name: "tdd", modelInvocable: true },
    { name: "internal", modelInvocable: false },
  ];

  expect(
    resolveSkillCapabilities(
      parseCapabilitySelection("skills", ["internal", "++tdd"]),
      { discovered, parent: ["research", "tdd"] },
    ),
  ).toEqual({ lazy: ["internal"], preloaded: ["tdd"] });
  expect(
    resolveSkillCapabilities(parseCapabilitySelection("skills", true), {
      discovered,
      parent: ["research"],
    }),
  ).toEqual({ lazy: ["research", "tdd"], preloaded: [] });
});

test("resolves parent-relative skill removal plus preload and rejects unknown names", () => {
  const snapshot = {
    discovered: [
      { name: "research", modelInvocable: true },
      { name: "tdd", modelInvocable: true },
    ],
    parent: ["research", "tdd"],
  };

  expect(
    resolveSkillCapabilities(
      parseCapabilitySelection("skills", ["-tdd", "++tdd"]),
      snapshot,
    ),
  ).toEqual({ lazy: ["research"], preloaded: ["tdd"] });
  expect(() =>
    resolveSkillCapabilities(
      parseCapabilitySelection("skills", ["missing"]),
      snapshot,
    ),
  ).toThrow("Unknown child skill: missing");
});
