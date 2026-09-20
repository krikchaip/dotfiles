import { expect, test } from "vitest";

import { appendChildPrompt } from "../../child/prompt.ts";

test("appends the frozen child suffix after the completed native prompt", () => {
  const nativePrompt =
    "Native context\n<available_skills>\n  <skill>tdd</skill>\n</available_skills>";
  const suffix =
    '<skill name="research">Preloaded</skill>\n\n<agent_instructions>Body</agent_instructions>';

  expect(appendChildPrompt(nativePrompt, suffix)).toBe(
    `${nativePrompt}\n\n${suffix}`,
  );
});

test("uses the frozen suffix when Pi supplies an empty system prompt", () => {
  expect(appendChildPrompt("", "suffix")).toBe("suffix");
});
