import type { Scenario } from "./types.ts";

export const child: Scenario = {
  name: "child",
  process: { child: true },
  async run() {},
};
