import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentSessionRuntime,
  createExtensionRuntime,
} from "@earendil-works/pi-coding-agent";
import { expect, test } from "vitest";

/**
 * Gives the native replacement coordinator an owned, model-free session surface.
 */
function session(file: string) {
  let disposed = false;
  return {
    isDisposed: () => disposed,
    native: {
      sessionFile: file,
      extensionRunner: { hasHandlers: () => false },
      abort: async () => {},
      dispose: () => {
        disposed = true;
      },
    } as unknown as ConstructorParameters<typeof AgentSessionRuntime>[0],
  };
}

test("rapid native replacements must not dispose a session while its UI rebind is pending", async () => {
  const root = mkdtempSync(join(tmpdir(), "sq-native-replacement-race-"));
  mkdirSync(join(root, "agent"));
  const files = ["A", "B"].map((letter) => {
    const file = join(root, `${letter}.jsonl`);
    writeFileSync(
      file,
      `${JSON.stringify({ type: "session", version: 3, id: `sq-race-${letter}`, timestamp: new Date().toISOString(), cwd: root })}\n`,
    );
    return file;
  });
  let beginFirst: () => void = () => {};
  let finishFirst: () => void = () => {};
  const firstStarted = new Promise<void>((resolve) => {
    beginFirst = resolve;
  });
  const firstBarrier = new Promise<void>((resolve) => {
    finishFirst = resolve;
  });
  const created: ReturnType<typeof session>[] = [];
  const services = {
    cwd: root,
    agentDir: join(root, "agent"),
  } as ConstructorParameters<typeof AgentSessionRuntime>[1];
  const runtime = new AgentSessionRuntime(
    session(join(root, "initial.jsonl")).native,
    services,
    async (options) => {
      const next = session(options.sessionManager.getSessionFile() as string);
      created.push(next);
      return {
        session: next.native,
        services,
        diagnostics: [],
        extensionsResult: {
          extensions: [],
          errors: [],
          runtime: createExtensionRuntime(),
        },
      };
    },
  );
  runtime.setRebindSession(async (current) => {
    if (current.sessionFile === files[0]) {
      beginFirst();
      await firstBarrier;
    }
  });
  const first = runtime.switchSession(files[0] as string);
  let second: Promise<unknown> | undefined;
  try {
    await firstStarted;
    second = runtime.switchSession(files[1] as string);
    // Drain ready microtasks without releasing the first lifecycle barrier.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect.soft(created).toHaveLength(1);
    expect.soft(created[0]?.isDisposed()).toBe(false);
  } finally {
    finishFirst();
    await Promise.allSettled([first, ...(second ? [second] : [])]);
    rmSync(root, { recursive: true, force: true });
  }
});
