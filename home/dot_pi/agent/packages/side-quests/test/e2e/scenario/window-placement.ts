import { configureBasicDelegation } from "../provider-support.ts";

type WindowRecord = Readonly<{
  id: string;
  index: number;
  name: string;
}>;

function parseWindows(output: string): WindowRecord[] {
  return output
    .trim()
    .split("\n")
    .flatMap((line) => {
      const [id, rawIndex, name] = line.split("\t");
      const index = Number(rawIndex);
      return id && Number.isInteger(index) && name ? [{ id, index, name }] : [];
    });
}

export const windowPlacement: Scenario = {
  name: "window-placement",
  process: {
    lifecycle: "interactive",
    managed: true,
  },
  timeoutMs: 45_000,
  configureProvider(context) {
    configureBasicDelegation(context, {
      interactive: true,
      prompt: "Stay open for window placement E2E.",
    });
  },
  async run(harness: E2EHarness) {
    const sessionId = (
      await harness.tmux(
        "display-message",
        "-p",
        "-t",
        harness.parentPane,
        "#{session_id}",
      )
    ).trim();
    const parentWindowId = (
      await harness.tmux(
        "display-message",
        "-p",
        "-t",
        harness.parentPane,
        "#{window_id}",
      )
    ).trim();

    await harness.tmux(
      "new-window",
      "-d",
      "-t",
      `${sessionId}:`,
      "-n",
      "existing-one",
    );
    await harness.tmux(
      "new-window",
      "-d",
      "-t",
      `${sessionId}:`,
      "-n",
      "existing-two",
    );

    const before = parseWindows(
      await harness.tmux(
        "list-windows",
        "-t",
        sessionId,
        "-F",
        "#{window_id}\t#{window_index}\t#{window_name}",
      ),
    );
    const parentBefore = before.find((window) => window.id === parentWindowId);
    const existingBefore = before.filter(
      (window) => window.id !== parentWindowId,
    );

    harness.assert(
      !!parentBefore,
      "Parent window was not listed before launch.",
    );
    harness.assert(
      existingBefore.length === 2,
      `Expected two existing windows before launch: ${JSON.stringify(before)}`,
    );

    await harness.sendParent("Delegate this E2E task now.", true);
    const childPane = await harness.childPane();
    const childWindowId = (
      await harness.tmux(
        "display-message",
        "-p",
        "-t",
        childPane,
        "#{window_id}",
      )
    ).trim();
    const after = parseWindows(
      await harness.tmux(
        "list-windows",
        "-t",
        sessionId,
        "-F",
        "#{window_id}\t#{window_index}\t#{window_name}",
      ),
    );
    const parentAfter = after.find((window) => window.id === parentWindowId);
    const childAfter = after.find((window) => window.id === childWindowId);

    harness.assert(!!parentAfter, "Parent window was not listed after launch.");
    harness.assert(!!childAfter, "Managed window was not listed after launch.");
    harness.assert(
      childAfter.index === parentAfter.index + 1,
      `Managed window was not directly after the parent: ${JSON.stringify(after)}`,
    );

    for (const existing of existingBefore) {
      const shifted = after.find((window) => window.id === existing.id);
      harness.assert(
        shifted?.index === existing.index + 1,
        `Existing window did not shift right intact: ${JSON.stringify(after)}`,
      );
    }

    const activeWindowId = (
      await harness.tmux(
        "display-message",
        "-p",
        "-t",
        harness.parentPane,
        "#{window_id}",
      )
    ).trim();
    harness.assert(
      activeWindowId === parentWindowId,
      "Detached managed-window insertion changed the parent pane window.",
    );

    await harness.waitFor(
      "Child completed its delegated E2E task.",
      10_000,
      childPane,
    );
    await harness.sendLiteral(childPane, "/subagent-done", true);
    await harness.waitFor("SUBAGENT COMPLETED");
  },
};
