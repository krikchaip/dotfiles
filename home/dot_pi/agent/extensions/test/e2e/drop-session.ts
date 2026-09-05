import { existsSync } from "node:fs";
import {
  cleanupSuite,
  CURRENT_ID,
  PARENT_ID,
  reportSuite,
  scenario,
  scenarioPaths,
  type SessionSeed,
  TmuxPi,
  withHarness,
} from "./fixture/session-topology-harness.ts";

try {
  await scenario("drop-guards-and-parent", async () => {
    const paths = scenarioPaths("drop-guards-and-parent");
    const parent: SessionSeed = {
      id: PARENT_ID,
      path: paths.parent,
      cwd: paths.cwd,
      messages: [{ role: "user", text: "DROP_PARENT_BODY" }],
    };
    const current: SessionSeed = {
      id: CURRENT_ID,
      path: paths.current,
      cwd: paths.cwd,
      parentSession: paths.parent,
      messages: [{ role: "user", text: "DROP_CURRENT_BODY" }],
    };
    await withHarness(
      "drop-guards-and-parent",
      { extensions: ["extensions/drop-session.ts"], session: current, sessions: [parent] },
      async (harness) => {
        await harness.sendLiteral("/drop ");
        const autocomplete = await harness.waitFor("Drop session and close current tmux pane");
        harness.assert(autocomplete.includes("--quit"), "Drop autocomplete omitted --quit");
        await harness.sendKeys("C-u");
        await harness.submitCommand("/drop bad");
        await harness.waitFor("Usage: /drop [-q|--quit]");
        harness.assert(existsSync(paths.current), "Invalid /drop deleted session");

        await harness.submitCommand("/drop");
        const pane = await harness.waitFor("SESSION TOPOLOGY READY 22222222");
        harness.assert(pane.includes("DROP_PARENT_BODY"), "Drop did not switch to parent active branch");
        harness.assert(!existsSync(paths.current), "Drop did not delete source session");
        harness.assert(existsSync(paths.parent), "Drop deleted parent session");
      },
    );
  });

  await scenario("drop-ephemeral", async () => {
    await withHarness(
      "drop-ephemeral",
      { extensions: ["extensions/drop-session.ts"], ephemeral: true },
      async (harness) => {
        await harness.submitCommand("/drop");
        await harness.waitFor("Nothing to drop (in-memory session)");
      },
    );
  });

  await scenario("drop-confirm-cancel", async () => {
    const paths = scenarioPaths("drop-confirm-cancel");
    const current: SessionSeed = {
      id: CURRENT_ID,
      path: paths.current,
      cwd: paths.cwd,
      messages: Array.from({ length: 101 }, (_, index) => ({
        role: "user" as const,
        text: `CONFIRM_MESSAGE_${index + 1}`,
      })),
    };
    await withHarness(
      "drop-confirm-cancel",
      { extensions: ["extensions/drop-session.ts"], session: current },
      async (harness) => {
        await harness.submitCommand("/drop");
        await harness.waitFor("Drop anyway?");
        await harness.sendKeys("Escape");
        await Bun.sleep(300);
        harness.assert(existsSync(paths.current), "Cancelled drop deleted session");
        const pane = await harness.capture();
        harness.assert(!pane.includes("Session dropped"), "Cancelled drop reported success");
      },
    );
  });

  await scenario("drop-confirm-accept-over-100", async () => {
    const paths = scenarioPaths("drop-confirm-accept-over-100");
    const current: SessionSeed = {
      id: CURRENT_ID,
      path: paths.current,
      cwd: paths.cwd,
      messages: Array.from({ length: 101 }, (_, index) => ({
        role: "user" as const,
        text: `A${index + 1}`,
      })),
    };
    await withHarness(
      "drop-confirm-accept-over-100",
      { extensions: ["extensions/drop-session.ts"], session: current },
      async (harness) => {
        await harness.submitCommand("/drop");
        const confirmation = await harness.waitFor("Drop anyway?");
        const entryCount = confirmation.match(/Session has (\d+) entries/)?.[1];
        harness.assert(
          Number(entryCount) > 100,
          `Drop confirmation did not report more than 100 entries: ${String(entryCount)}`,
        );
        await harness.sendKeys("Enter");
        await harness.waitFor("Session dropped", 8_000);
        harness.assert(
          !existsSync(paths.current),
          "Accepted drop confirmation did not delete the source session",
        );
      },
    );
    console.log("PASS drop-session confirm-accept-over-100");
  });

  await scenario("drop-streaming-shortcut", async () => {
    const paths = scenarioPaths("drop-streaming-shortcut");
    const current: SessionSeed = { id: CURRENT_ID, path: paths.current, cwd: paths.cwd };
    await withHarness(
      "drop-streaming-shortcut",
      {
        extensions: ["extensions/drop-session.ts"],
        session: current,
        providerDelayMs: 2_500,
      },
      async (harness) => {
        await harness.submitPrompt("hold the provider open");
        await harness.waitUntil("provider to become active", () => existsSync(harness.providerActivePath));
        await Bun.sleep(150);
        await harness.sendLiteral("\x1bq");
        await harness.waitFor("Cannot drop session while agent is streaming");
        harness.assert(existsSync(paths.current), "Streaming drop shortcut deleted session");
        await harness.waitFor("SESSION TOPOLOGY PROVIDER RESPONSE", 8_000);
      },
    );
  });

  await scenario("drop-quit-pane", async () => {
    const paths = scenarioPaths("drop-quit-pane");
    const current: SessionSeed = { id: CURRENT_ID, path: paths.current, cwd: paths.cwd };
    const harness = await TmuxPi.start("drop-quit-pane", {
      extensions: ["extensions/drop-session.ts"],
      session: current,
    });
    try {
      await harness.submitCommand("/drop --quit");
      await harness.waitUntil("source pane to close", async () => (await harness.paneIds()).length === 0, 8_000);
      harness.assert(!existsSync(paths.current), "Drop --quit did not delete source session");
    } finally {
      await harness.abort();
    }
  });


  reportSuite("drop-session");
} finally {
  await cleanupSuite();
}
