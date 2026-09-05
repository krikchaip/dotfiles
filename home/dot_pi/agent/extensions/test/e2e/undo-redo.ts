import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PiTuiHarness } from "./harness.ts";
import {
  cleanupSuite,
  CURRENT_ID,
  type MessageSeed,
  reportSuite,
  scenario,
  scenarioPaths,
  runDirectory,
  type SessionSeed,
  withHarness,
} from "./fixture/session-topology-harness.ts";

try {
  const oldUndoMessages: MessageSeed[] = [
    { role: "user", text: "UNDO_USER_ONE", id: "undo-user-one" },
    { role: "assistant", text: "UNDO_ASSISTANT_ONE", id: "undo-assistant-one" },
    { role: "user", text: "UNDO_USER_TWO", id: "undo-user-two" },
    { role: "assistant", text: "UNDO_ASSISTANT_TWO", id: "undo-assistant-two" },
  ];

  await scenario("undo-redo-navigation-and-reset", async () => {
    const paths = scenarioPaths("undo-redo-navigation-and-reset");
    const current: SessionSeed = {
      id: CURRENT_ID,
      path: paths.current,
      cwd: paths.cwd,
      messages: oldUndoMessages,
    };
    await withHarness(
      "undo-redo-navigation-and-reset",
      { extensions: ["extensions/undo-redo.ts"], session: current },
      async (harness) => {
        await harness.submitCommand("/undo");
        let pane = await harness.waitFor("1 message reverted");
        harness.assert(pane.includes("UNDO_USER_TWO"), "Undo did not restore latest user text");
        await harness.sendKeys("C-u");
        await harness.submitCommand("/e2e-leaf");
        await harness.waitFor("E2E LEAF undo-assistant-one");

        await harness.submitCommand("/redo");
        await harness.submitCommand("/e2e-leaf");
        await harness.waitFor("LAST MESSAGE undo-assistant-two");

        await harness.sendLiteral("DIRTY_DRAFT");
        await harness.sendLiteral("\x1bu");
        await harness.waitUntil("dirty-editor guard and preserved draft", async () => {
          pane = await harness.capture();
          return pane.includes("Editor not empty; clear it before undo/redo") && pane.includes("DIRTY_DRAFT");
        });
        await harness.sendKeys("C-u");

        await harness.submitCommand("/undo");
        await harness.waitFor("1 message reverted");
        await harness.sendKeys("C-u");
        const treeEventsBefore = harness.treeEventCount();
        await harness.submitCommand("/tree");
        await harness.waitFor("Session Tree");
        await harness.sendKeys("Down", "Down", "Enter");
        await harness.waitUntil(
          "manual /tree session_tree reset",
          () => harness.treeEventCount() > treeEventsBefore,
        );
        const navigated = await harness.waitFor("Navigated to selected point");
        harness.assert(navigated.includes("UNDO_ASSISTANT_TWO"), "/tree did not restore selected branch");
        await harness.submitCommand("/redo");
        await harness.waitFor("Nothing to redo");
      },
    );
  });

  await scenario("undo-redo-multi-level", async () => {
    const paths = scenarioPaths("undo-redo-multi-level");
    const current: SessionSeed = { id: CURRENT_ID, path: paths.current, cwd: paths.cwd, messages: oldUndoMessages };
    await withHarness(
      "undo-redo-multi-level",
      { extensions: ["extensions/undo-redo.ts"], session: current },
      async (harness) => {
        await harness.submitCommand("/undo");
        await harness.waitFor("1 message reverted");
        await harness.sendKeys("C-u");
        await harness.submitCommand("/undo");
        await harness.waitUntil("second undo and restored first prompt", async () => {
          const pane = await harness.capture();
          return pane.includes("2 message reverted") && pane.includes("UNDO_USER_ONE");
        });
        await harness.sendKeys("C-u");
        await harness.submitCommand("/redo");
        await harness.waitFor("1 message reverted");
        await harness.sendKeys("C-u");
        await harness.submitCommand("/e2e-leaf");
        await harness.waitFor("E2E LEAF undo-assistant-one");
        await harness.submitCommand("/redo");
        await harness.submitCommand("/e2e-leaf");
        await harness.waitFor("LAST MESSAGE undo-assistant-two");
        await harness.submitCommand("/redo");
        await harness.waitFor("Nothing to redo");
      },
    );
  });

  await scenario("undo-recent-delete", async () => {
    const paths = scenarioPaths("undo-recent-delete");
    const current: SessionSeed = {
      id: CURRENT_ID,
      path: paths.current,
      cwd: paths.cwd,
      recent: true,
      messages: oldUndoMessages,
    };
    await withHarness(
      "undo-recent-delete",
      { extensions: ["extensions/undo-redo.ts"], session: current },
      async (harness) => {
        await harness.submitCommand("/undo");
        const pane = await harness.waitFor("1 message deleted, 3 nodes pruned");
        harness.assert(pane.includes("UNDO_USER_TWO"), "Recent undo did not restore prompt text");
        const session = readFileSync(paths.current, "utf8");
        harness.assert(!session.includes("UNDO_USER_TWO"), "Recent undo retained deleted user node");
        harness.assert(!session.includes("UNDO_ASSISTANT_TWO"), "Recent undo retained deleted assistant node");
        harness.assert(session.includes("UNDO_ASSISTANT_ONE"), "Recent undo deleted earlier branch history");
        await harness.sendKeys("C-u");
        await harness.submitCommand("/redo");
        await harness.waitFor("Nothing to redo");
      },
    );
  });

  await scenario("undo-delete-window-expiry", async () => {
    const paths = scenarioPaths("undo-delete-window-expiry");
    const current: SessionSeed = {
      id: CURRENT_ID,
      path: paths.current,
      cwd: paths.cwd,
      recent: true,
      messages: oldUndoMessages,
    };
    await withHarness(
      "undo-delete-window-expiry",
      { extensions: ["extensions/undo-redo.ts"], session: current },
      async (harness) => {
        await Bun.sleep(14_000);
        await harness.submitCommand("/undo");
        const pane = await harness.waitFor("1 message reverted");
        harness.assert(pane.includes("UNDO_USER_TWO"), "Expired undo window did not restore prompt text");
        harness.assert(readFileSync(paths.current, "utf8").includes("UNDO_USER_TWO"), "Expired undo window still deleted user node");
        await harness.sendKeys("C-u");
      },
    );
  });

  await scenario("undo-image-text-only", async () => {
    const paths = scenarioPaths("undo-image-text-only");
    const baseTime = Date.UTC(2025, 0, 1);
    writeFileSync(paths.current, [
      { type: "session", version: 3, id: CURRENT_ID, timestamp: new Date(baseTime).toISOString(), cwd: paths.cwd },
      {
        type: "message", id: "image-user", parentId: null, timestamp: new Date(baseTime + 100).toISOString(),
        message: {
          role: "user",
          content: [
            { type: "text", text: "UNDO_IMAGE_TEXT" },
            { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
          ],
          timestamp: baseTime + 100,
        },
      },
      {
        type: "message", id: "image-assistant", parentId: "image-user", timestamp: new Date(baseTime + 200).toISOString(),
        message: {
          role: "assistant", content: [{ type: "text", text: "IMAGE_RESPONSE" }],
          api: "openai-completions", provider: "image-e2e", model: "fake",
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: "stop", timestamp: baseTime + 200,
        },
      },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    const harness = await PiTuiHarness.start({
      name: "undo-image-text-only",
      root: resolve(import.meta.dir, "../../.."),
      runDirectory,
      persistSession: true,
      cliArguments: ["--session-dir", paths.sessions, "--session", paths.current],
      extensions: ["extensions/undo-redo.ts"],
    });
    try {
      await harness.sendLiteral("/undo");
      await harness.sendKeys("Escape", "Enter");
      const pane = await harness.waitFor("Undo restored text only; images cannot be restored to editor");
      harness.assert(pane.includes("UNDO_IMAGE_TEXT"), "Image undo did not restore text content");
      await harness.sendKeys("C-u");
      await harness.finish();
    } finally {
      await harness.abort().catch(() => undefined);
    }
  });

  await scenario("undo-streaming-shortcut", async () => {
    const paths = scenarioPaths("undo-streaming-shortcut");
    const current: SessionSeed = { id: CURRENT_ID, path: paths.current, cwd: paths.cwd, messages: oldUndoMessages };
    await withHarness(
      "undo-streaming-shortcut",
      {
        extensions: ["extensions/undo-redo.ts"],
        session: current,
        providerDelayMs: 2_500,
      },
      async (harness) => {
        await harness.submitPrompt("STREAM_UNDO_PROMPT");
        await harness.waitUntil("provider to become active", () => existsSync(harness.providerActivePath));
        await harness.sendLiteral("\x1bu");
        const pane = await harness.waitFor(/message (?:deleted|reverted)/, 8_000);
        harness.assert(pane.includes("STREAM_UNDO_PROMPT"), "Streaming undo did not restore the interrupted prompt");
        harness.assert(!readFileSync(paths.current, "utf8").includes("SESSION TOPOLOGY PROVIDER RESPONSE"), "Streaming undo retained aborted response");
      },
    );
  });

  await scenario("redo-streaming-shortcut", async () => {
    const paths = scenarioPaths("redo-streaming-shortcut");
    const current: SessionSeed = { id: CURRENT_ID, path: paths.current, cwd: paths.cwd };
    await withHarness(
      "redo-streaming-shortcut",
      {
        extensions: ["extensions/undo-redo.ts"],
        session: current,
        providerDelayMs: 2_500,
      },
      async (harness) => {
        await harness.submitPrompt("stream for redo guard");
        await harness.waitUntil("provider to become active", () => existsSync(harness.providerActivePath));
        await harness.sendLiteral("\x1bU");
        await harness.waitFor("Cannot redo while streaming");
        await harness.waitFor("SESSION TOPOLOGY PROVIDER RESPONSE", 8_000);
      },
    );
  });


  reportSuite("undo-redo");
} finally {
  await cleanupSuite();
}
