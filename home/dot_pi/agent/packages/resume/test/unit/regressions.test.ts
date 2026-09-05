import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { patchDeleteActiveSession } from "../../delete-active-session.ts";
import { wrapWithSessionPreview } from "../../session-preview.ts";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const path of tempDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function activeDeleteHarness(
  path: string,
  onDelete: (path: string) => void | Promise<void>,
) {
  let clearCount = 0;
  let confirmationPath: string | undefined;
  const sessionList: Record<string, any> = {
    filteredSessions: [{ session: { path } }],
    selectedIndex: 0,
    isCurrentSessionPath: (candidate: string) => candidate === path,
    setConfirmingDeletePath: (candidate: string) => {
      confirmationPath = candidate;
    },
    onDeleteSession: onDelete,
  };
  const selector = { sessionList };
  patchDeleteActiveSession(selector, {
    handleClearCommand: async () => {
      clearCount++;
    },
  });
  return {
    sessionList,
    confirmationPath: () => confirmationPath,
    clearCount: () => clearCount,
  };
}

describe("resume regression boundaries", () => {
  test("[KNOWN RED] Ctrl+R reaches Pi rename instead of preview", () => {
    const delegated: string[] = [];
    const selector = {
      focused: true,
      handleInput: (data: string) => delegated.push(data),
    };
    const wrapper = wrapWithSessionPreview(
      selector,
      {
        keybindings: { matches: () => false },
        ui: { requestRender: () => undefined },
      },
      () => undefined,
      {
        loadEntriesFromFile: () => [],
        getMarkdownTheme: () => ({}),
        theme: {},
        components: {},
      },
    );

    wrapper.handleInput("\x12");
    expect(delegated).toEqual(["\x12"]);
  });

  test("[KNOWN RED] failed active deletion keeps the active session and picker state", async () => {
    const directory = mkdtempSync(join(tmpdir(), "resume-delete-unit-"));
    tempDirectories.push(directory);
    const path = join(directory, "active.jsonl");
    writeFileSync(path, "active\n");
    const harness = activeDeleteHarness(path, () => undefined);

    harness.sessionList.startDeleteConfirmationForSelectedSession();
    expect(harness.confirmationPath()).toBe(path);
    await harness.sessionList.onDeleteSession(path);

    expect(existsSync(path)).toBe(true);
    expect(harness.clearCount()).toBe(0);
  });

  test("successful active deletion starts a new session after removal", async () => {
    const directory = mkdtempSync(join(tmpdir(), "resume-delete-unit-"));
    tempDirectories.push(directory);
    const path = join(directory, "active.jsonl");
    writeFileSync(path, "active\n");
    const harness = activeDeleteHarness(path, () => unlinkSync(path));

    await harness.sessionList.onDeleteSession(path);

    expect(existsSync(path)).toBe(false);
    expect(harness.clearCount()).toBe(1);
  });

  test("[KNOWN RED] unexpected core delete errors stay exact and do not clear", async () => {
    const directory = mkdtempSync(join(tmpdir(), "resume-delete-unit-"));
    tempDirectories.push(directory);
    const path = join(directory, "active.jsonl");
    writeFileSync(path, "active\n");
    const harness = activeDeleteHarness(path, () => {
      throw new Error("exact delete failure");
    });

    await expect(harness.sessionList.onDeleteSession(path)).rejects.toThrow(
      "exact delete failure",
    );
    expect(harness.clearCount()).toBe(0);
  });
});
