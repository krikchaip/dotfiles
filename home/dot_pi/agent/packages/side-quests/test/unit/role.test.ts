import { expect, test } from "vitest";

import { CHILD_ID_ENV, detectRole } from "../../role.ts";

test("is inert outside tmux", () => {
  expect(detectRole({})).toBe("inert");
  expect(detectRole({ TMUX: "" })).toBe("inert");
});

test("selects the parent inside tmux", () => {
  expect(detectRole({ TMUX: "/tmp/tmux-501/default,1,0" })).toBe("parent");
});

test("selects the child only for a managed child inside tmux", () => {
  expect(
    detectRole({
      TMUX: "/tmp/tmux-501/default,1,0",
      [CHILD_ID_ENV]: "child-1",
    }),
  ).toBe("child");
  expect(detectRole({ [CHILD_ID_ENV]: "child-1" })).toBe("inert");
});
