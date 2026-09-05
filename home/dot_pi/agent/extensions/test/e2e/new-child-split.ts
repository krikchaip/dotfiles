import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cleanupSuite,
  CURRENT_ID,
  readHeader,
  reportSuite,
  scenario,
  scenarioPaths,
  type SessionSeed,
  withHarness,
} from "./fixture/session-topology-harness.ts";

try {
  await scenario("new-same-pane-and-shortcut", async () => {
    const paths = scenarioPaths("new-same-pane-and-shortcut");
    const current: SessionSeed = {
      id: CURRENT_ID,
      path: paths.current,
      cwd: paths.cwd,
      messages: [{ role: "user", text: "NEW_PARENT_BODY" }],
    };
    await withHarness(
      "new-same-pane-and-shortcut",
      {
        extensions: [
          "extensions/kitty-alt-keys.ts",
          "extensions/new-child-split.ts",
        ],
        session: current,
        providerDelayMs: 0,
      },
      async (harness) => {
        await harness.sendLiteral("/new ");
        const autocomplete = await harness.waitFor(
          "Create a blank child session",
        );
        harness.assert(
          autocomplete.includes("--sp") &&
            autocomplete.includes("--vsp") &&
            autocomplete.includes("--win"),
          "New autocomplete omitted tmux forms",
        );
        await harness.sendKeys("C-u");
        await harness.submitCommand("/new wrong");
        await harness.waitFor("Usage: /new [--sp|--vsp|--win] [child]");

        await harness.sendLiteral("PRESERVED_DRAFT");
        await harness.sendLiteral("\x1bN");
        const pane = await harness.waitFor(
          /SESSION TOPOLOGY READY (?!11111111)/,
        );
        harness.assert(
          pane.includes("PRESERVED_DRAFT"),
          "New-child shortcut lost editor draft",
        );
        harness.assert(
          !pane.includes("NEW_PARENT_BODY"),
          "New child copied source context into its branch",
        );
        harness.assert(
          [...new Bun.Glob("*.jsonl").scanSync(paths.sessions)].length === 1,
          "Blank same-pane child persisted before its first message",
        );

        await harness.sendKeys("C-u");
        await harness.submitPrompt("E2E_CHILD_PERSIST");
        await harness.waitFor("SESSION TOPOLOGY PROVIDER RESPONSE");
        await harness.waitUntil(
          "child persistence after first message",
          () =>
            [...new Bun.Glob("*.jsonl").scanSync(paths.sessions)].length === 2,
        );
        const files = [...new Bun.Glob("*.jsonl").scanSync(paths.sessions)].map(
          (name) => join(paths.sessions, name),
        );
        const child = files.find((path) => path !== paths.current);
        harness.assert(
          child,
          "New child did not persist after its first message",
        );
        const header = readHeader(child!);
        harness.assert(
          header.parentSession === paths.current,
          "Persisted child lacks source parent link",
        );
        harness.assert(
          !readFileSync(child!, "utf8").includes("NEW_PARENT_BODY"),
          "Persisted child copied source context",
        );
      },
    );
  });

  await scenario("new-ephemeral-child-guard", async () => {
    await withHarness(
      "new-ephemeral-child-guard",
      { extensions: ["extensions/new-child-split.ts"], ephemeral: true },
      async (harness) => {
        await harness.submitCommand("/new child");
        await harness.waitFor(
          "Current session has no valid session file; cannot create a child session",
        );
      },
    );
  });

  await scenario("new-tmux-targets", async () => {
    const paths = scenarioPaths("new-tmux-targets");
    const current: SessionSeed = {
      id: CURRENT_ID,
      path: paths.current,
      cwd: paths.cwd,
    };
    await withHarness(
      "new-tmux-targets",
      {
        extensions: ["extensions/new-child-split.ts"],
        session: current,
        width: 120,
      },
      async (harness) => {
        await harness.submitCommand("/new --vsp child");
        await harness.waitUntil(
          "vertical child pane",
          async () => (await harness.paneIds()).length === 2,
        );
        let panes = await harness.paneIds();
        const verticalChildPane = panes.find(
          (pane) => pane !== harness.paneId,
        )!;
        const dimensions = await harness.tmux(
          "display-message",
          "-p",
          "-t",
          verticalChildPane,
          "#{pane_width}x#{pane_height}",
        );
        harness.assert(
          Number.parseInt(dimensions, 10) < 120,
          "--vsp did not create a side-by-side pane",
        );
        let children = [...new Bun.Glob("*.jsonl").scanSync(paths.sessions)]
          .map((name) => join(paths.sessions, name))
          .filter(
            (path) =>
              path !== paths.current &&
              readHeader(path).parentSession === paths.current,
          );
        harness.assert(
          children.length === 1,
          "--vsp child did not create one blank linked child",
        );
        await harness.tmux("kill-pane", "-t", verticalChildPane);

        await harness.submitCommand("/new --sp");
        await harness.waitUntil(
          "horizontal session pane",
          async () => (await harness.paneIds()).length === 2,
        );
        panes = await harness.paneIds();
        const horizontalPane = panes.find((pane) => pane !== harness.paneId)!;
        const horizontalDimensions = await harness.tmux(
          "display-message",
          "-p",
          "-t",
          horizontalPane,
          "#{pane_width}x#{pane_height}",
        );
        harness.assert(
          Number.parseInt(horizontalDimensions.split("x")[1] ?? "0", 10) < 36,
          "--sp did not create a top/bottom pane",
        );
        await harness.tmux("kill-pane", "-t", horizontalPane);

        const initialWindows = await harness.windowIds();
        await harness.submitCommand("/new --win child");
        await harness.waitUntil(
          "child window",
          async () =>
            (await harness.windowIds()).length === initialWindows.length + 1,
        );
        const windows = await harness.windowIds();
        const childWindow = windows.find(
          (window) => !initialWindows.includes(window),
        );
        harness.assert(childWindow, "--win did not create a new tmux window");
        children = [...new Bun.Glob("*.jsonl").scanSync(paths.sessions)]
          .map((name) => join(paths.sessions, name))
          .filter(
            (path) =>
              path !== paths.current &&
              readHeader(path).parentSession === paths.current,
          );
        harness.assert(
          children.length === 2,
          "--win child did not create a second linked child",
        );
        await harness.tmux("kill-window", "-t", childWindow!);
      },
    );
  });

  await scenario("new-window-adjacent-placement", async () => {
    const paths = scenarioPaths("new-window-adjacent-placement");
    const current: SessionSeed = {
      id: CURRENT_ID,
      path: paths.current,
      cwd: paths.cwd,
    };
    await withHarness(
      "new-window-adjacent-placement",
      {
        extensions: ["extensions/new-child-split.ts"],
        session: current,
        width: 120,
      },
      async (harness) => {
        const sourceWindow = (
          await harness.tmux(
            "display-message",
            "-p",
            "-t",
            harness.paneId,
            "#{window_id}",
          )
        ).trim();
        const leftWindow = (
          await harness.tmux(
            "new-window",
            "-d",
            "-b",
            "-t",
            sourceWindow,
            "-P",
            "-F",
            "#{window_id}",
          )
        ).trim();
        const rightWindow = (
          await harness.tmux(
            "new-window",
            "-d",
            "-a",
            "-t",
            sourceWindow,
            "-P",
            "-F",
            "#{window_id}",
          )
        ).trim();
        harness.assert(
          JSON.stringify(await harness.windowIds()) ===
            JSON.stringify([leftWindow, sourceWindow, rightWindow]),
          "Fixture did not place windows on both sides of the source",
        );

        await harness.submitCommand("/new --win child");
        await harness.waitUntil(
          "adjacent child window",
          async () => (await harness.windowIds()).length === 4,
        );
        const ordered = await harness.windowIds();
        const childWindow = ordered.find(
          (window) => ![leftWindow, sourceWindow, rightWindow].includes(window),
        );
        harness.assert(childWindow, "--win did not create a child window");
        harness.assert(
          JSON.stringify(ordered) ===
            JSON.stringify([
              leftWindow,
              sourceWindow,
              childWindow,
              rightWindow,
            ]),
          `Child window was not exactly after the source: ${ordered.join(", ")}`,
        );
      },
    );
  });

  await scenario("new-same-pane-command-forms", async () => {
    const plainPaths = scenarioPaths("new-same-pane-plain-command");
    const plain: SessionSeed = {
      id: CURRENT_ID,
      path: plainPaths.current,
      cwd: plainPaths.cwd,
      messages: [{ role: "user", text: "PLAIN_NEW_SOURCE" }],
    };
    await withHarness(
      "new-same-pane-plain-command",
      { extensions: ["extensions/new-child-split.ts"], session: plain },
      async (harness) => {
        await harness.submitCommand("/new");
        const pane = await harness.waitFor("New session started");
        harness.assert(
          !pane.includes("PLAIN_NEW_SOURCE"),
          "Plain /new copied old context",
        );
        harness.assert(
          existsSync(plainPaths.current),
          "Plain /new removed source session",
        );
      },
    );

    const childPaths = scenarioPaths("new-same-pane-child-command");
    const childSource: SessionSeed = {
      id: CURRENT_ID,
      path: childPaths.current,
      cwd: childPaths.cwd,
      messages: [{ role: "user", text: "DIRECT_CHILD_SOURCE" }],
    };
    await withHarness(
      "new-same-pane-child-command",
      { extensions: ["extensions/new-child-split.ts"], session: childSource },
      async (harness) => {
        await harness.submitCommand("/new child");
        const pane = await harness.waitFor("New child session started");
        harness.assert(
          !pane.includes("DIRECT_CHILD_SOURCE"),
          "Direct child copied source context",
        );
      },
    );
  });

  await scenario("new-tmux-command-shortcut-matrix", async () => {
    const paths = scenarioPaths("new-tmux-command-shortcut-matrix");
    const current: SessionSeed = {
      id: CURRENT_ID,
      path: paths.current,
      cwd: paths.cwd,
    };
    await withHarness(
      "new-tmux-command-shortcut-matrix",
      {
        extensions: [
          "extensions/kitty-alt-keys.ts",
          "extensions/new-child-split.ts",
        ],
        session: current,
        width: 120,
      },
      async (harness) => {
        const cases = [
          {
            label: "command sp child",
            input: "/new --sp child",
            command: true,
            target: "pane",
            child: true,
          },
          {
            label: "command vsp plain",
            input: "/new --vsp",
            command: true,
            target: "pane",
            child: false,
          },
          {
            label: "command win plain",
            input: "/new --win",
            command: true,
            target: "window",
            child: false,
          },
          {
            label: "shortcut sp plain",
            input: "\x1bs",
            command: false,
            target: "pane",
            child: false,
          },
          {
            label: "shortcut sp child",
            input: "\x1bS",
            command: false,
            target: "pane",
            child: true,
          },
          {
            label: "shortcut vsp plain",
            input: "\x1bv",
            command: false,
            target: "pane",
            child: false,
          },
          {
            label: "shortcut vsp child",
            input: "\x1bV",
            command: false,
            target: "pane",
            child: true,
          },
          {
            label: "shortcut win plain",
            input: "\x1bw",
            command: false,
            target: "window",
            child: false,
          },
          {
            label: "shortcut win child",
            input: "\x1bW",
            command: false,
            target: "window",
            child: true,
          },
        ] as const;
        let linkedChildren = 0;
        for (const testCase of cases) {
          const panesBefore = await harness.paneIds();
          const windowsBefore = await harness.windowIds();
          if (testCase.command) await harness.submitCommand(testCase.input);
          else await harness.sendLiteral(testCase.input);
          if (testCase.target === "window") {
            await harness.waitUntil(
              testCase.label,
              async () =>
                (await harness.windowIds()).length === windowsBefore.length + 1,
            );
          } else {
            await harness.waitUntil(
              testCase.label,
              async () =>
                (await harness.paneIds()).length === panesBefore.length + 1,
            );
          }
          const panesAfter = await harness.paneIds();
          const childPane = panesAfter.find(
            (pane) => !panesBefore.includes(pane),
          );
          harness.assert(
            childPane,
            `${testCase.label} did not create a target pane`,
          );
          if (testCase.child) {
            linkedChildren++;
            await harness.waitUntil(`${testCase.label} child file`, () => {
              const children = [
                ...new Bun.Glob("*.jsonl").scanSync(paths.sessions),
              ]
                .map((name) => join(paths.sessions, name))
                .filter(
                  (path) =>
                    path !== paths.current &&
                    readHeader(path).parentSession === paths.current,
                );
              return children.length === linkedChildren;
            });
          }
          if (testCase.target === "window") {
            const windowsAfter = await harness.windowIds();
            const childWindow = windowsAfter.find(
              (window) => !windowsBefore.includes(window),
            );
            harness.assert(
              childWindow,
              `${testCase.label} did not create a window`,
            );
            await harness.tmux("kill-window", "-t", childWindow!);
          } else {
            await harness.tmux("kill-pane", "-t", childPane!);
          }
        }
      },
    );
  });

  await scenario("new-streaming-rules", async () => {
    const paths = scenarioPaths("new-streaming-rules");
    const current: SessionSeed = {
      id: CURRENT_ID,
      path: paths.current,
      cwd: paths.cwd,
    };
    await withHarness(
      "new-streaming-rules",
      {
        extensions: [
          "extensions/kitty-alt-keys.ts",
          "extensions/new-child-split.ts",
        ],
        session: current,
        providerDelayMs: 3_000,
        width: 120,
      },
      async (harness) => {
        await harness.submitPrompt("stream while opening sessions");
        await harness.waitUntil("provider to become active", () =>
          existsSync(harness.providerActivePath),
        );
        await harness.sendLiteral("\x1bN");
        await harness.waitFor(
          "Cannot run same-pane /new while agent is streaming",
        );
        harness.assert(
          (await harness.paneIds()).length === 1,
          "Blocked same-pane new created a pane",
        );

        await harness.sendLiteral("\x1bV");
        await harness.waitUntil(
          "streaming child split",
          async () => (await harness.paneIds()).length === 2,
        );
        const childPane = (await harness.paneIds()).find(
          (pane) => pane !== harness.paneId,
        );
        harness.assert(
          childPane,
          "Streaming child split did not create a pane",
        );
        const childFiles = [...new Bun.Glob("*.jsonl").scanSync(paths.sessions)]
          .map((name) => join(paths.sessions, name))
          .filter(
            (path) =>
              path !== paths.current &&
              readHeader(path).parentSession === paths.current,
          );
        harness.assert(
          childFiles.length === 1,
          "Streaming child split lacks linked blank child",
        );
        await harness.tmux("kill-pane", "-t", childPane!);
        await harness.waitFor("SESSION TOPOLOGY PROVIDER RESPONSE", 8_000);
      },
    );
  });

  await scenario("new-child-startup-failure-cleanup", async () => {
    const paths = scenarioPaths("new-child-startup-failure-cleanup");
    const current: SessionSeed = {
      id: CURRENT_ID,
      path: paths.current,
      cwd: paths.cwd,
    };
    await withHarness(
      "new-child-startup-failure-cleanup",
      {
        extensions: [
          "extensions/test/e2e/fixture/new-child-startup-failure.ts",
          "extensions/new-child-split.ts",
        ],
        session: current,
      },
      async (harness) => {
        await harness.submitCommand("/e2e-break-child-startup");
        await harness.waitFor("E2E child startup will fail");
        await harness.submitCommand("/new --sp child");
        await Bun.sleep(1_500);
        const childFiles = [...new Bun.Glob("*.jsonl").scanSync(paths.sessions)]
          .map((name) => join(paths.sessions, name))
          .filter(
            (path) =>
              path !== paths.current &&
              readHeader(path).parentSession === paths.current,
          );
        harness.assert(
          childFiles.length === 0,
          "Failed child Pi startup left an orphan child session file",
        );
      },
    );
  });

  reportSuite("new-child-split");
} finally {
  await cleanupSuite();
}
