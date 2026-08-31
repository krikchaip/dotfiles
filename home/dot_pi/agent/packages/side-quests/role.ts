export const CHILD_ID_ENV = "PI_SIDE_QUESTS_CHILD_ID";
export const PARENT_PANE_ENV = "PI_SIDE_QUESTS_PARENT_PANE";

export const UNSUPPORTED_TMUX_WARNING =
  "Side Quests: tmux is required; extension is inactive.";

export type RuntimeRole = "inert" | "parent" | "child";

export type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export function detectRole(environment: RuntimeEnvironment): RuntimeRole {
  if (!environment.TMUX?.trim()) return "inert";
  return environment[CHILD_ID_ENV]?.trim() ? "child" : "parent";
}

export function currentEnvironment(): RuntimeEnvironment {
  return (
    (globalThis as { process?: { env?: RuntimeEnvironment } }).process?.env ??
    {}
  );
}
