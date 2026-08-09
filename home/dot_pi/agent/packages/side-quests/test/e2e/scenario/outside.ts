import type { Scenario } from "./types.ts";

export const outside: Scenario = {
  name: "outside",
  process: { outsideTmux: true },
  async run() {},
};
