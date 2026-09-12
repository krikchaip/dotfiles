import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";

import { fadeOutLineEnding } from "../../renderer/fade-out.ts";
import {
  registerTerminalForegroundQuery,
  terminalForeground,
} from "../../renderer/terminal-foreground.ts";

test("queries and remembers the terminal default foreground without consuming keyboard input", async () => {
  let sessionStart:
    ((event: unknown, context: ExtensionContext) => Promise<void>) | undefined;
  let terminalInput:
    | ((data: string) => { consume?: boolean; data?: string } | undefined)
    | undefined;
  const writes: string[] = [];
  const theme = {} as Theme;
  const pi = {
    on(event: string, handler: typeof sessionStart) {
      if (event === "session_start") sessionStart = handler;
    },
  } as ExtensionAPI;

  registerTerminalForegroundQuery(pi, {
    timeoutMs: 100,
    write: (data) => writes.push(data),
  });

  const started = sessionStart?.({ type: "session_start" }, {
    mode: "tui",
    ui: {
      onTerminalInput(handler: typeof terminalInput) {
        terminalInput = handler;
        return () => {
          terminalInput = undefined;
        };
      },
      theme,
    },
  } as ExtensionContext);

  expect(writes).toEqual(["\u001b]10;?\u0007"]);
  expect(terminalInput?.("x")).toBeUndefined();
  expect(terminalInput?.("\u001b]11;rgb:1111/2222/3333\u0007")).toBeUndefined();
  expect(terminalInput?.("\u001b]10;rgb:c0c0/caca/f5f5\u0007")).toEqual({
    consume: true,
  });
  await started;

  expect(terminalForeground(theme)).toEqual({ r: 192, g: 202, b: 245 });
});

test("fades terminal-default theme text from the queried foreground", async () => {
  let sessionStart:
    ((event: unknown, context: ExtensionContext) => Promise<void>) | undefined;
  let terminalInput:
    | ((data: string) => { consume?: boolean; data?: string } | undefined)
    | undefined;
  const theme = {
    getBgAnsi: () => "\u001b[48;2;20;30;40m",
    getColorMode: () => "truecolor",
    getFgAnsi: () => "\u001b[39m",
  } as unknown as Theme;
  const pi = {
    on(event: string, handler: typeof sessionStart) {
      if (event === "session_start") sessionStart = handler;
    },
  } as ExtensionAPI;

  registerTerminalForegroundQuery(pi, { timeoutMs: 100, write: () => {} });
  const started = sessionStart?.({ type: "session_start" }, {
    mode: "tui",
    ui: {
      onTerminalInput(handler: typeof terminalInput) {
        terminalInput = handler;
        return () => {
          terminalInput = undefined;
        };
      },
      theme,
    },
  } as ExtensionContext);
  terminalInput?.("\u001b]10;rgb:c0c0/caca/f5f5\u001b\\");
  await started;

  const faded = fadeOutLineEnding(
    `${"A".repeat(20)}…`,
    theme,
    "customMessageText",
  );

  expect(faded).toContain("\u001b[38;2;58;68;85m…");
});

test.each([
  ["#123456", { r: 18, g: 52, b: 86 }],
  ["#abcd1234fedc", { r: 171, g: 18, b: 254 }],
])("accepts the OSC 10 hash reply %s", async (reply, expected) => {
  let sessionStart:
    ((event: unknown, context: ExtensionContext) => Promise<void>) | undefined;
  let terminalInput:
    | ((data: string) => { consume?: boolean; data?: string } | undefined)
    | undefined;
  const theme = {
    getFgAnsi: () => "\u001b[39m",
  } as unknown as Theme;
  const pi = {
    on(event: string, handler: typeof sessionStart) {
      if (event === "session_start") sessionStart = handler;
    },
  } as ExtensionAPI;

  registerTerminalForegroundQuery(pi, { timeoutMs: 100, write: () => {} });
  const started = sessionStart?.({ type: "session_start" }, {
    mode: "tui",
    ui: {
      onTerminalInput(handler: typeof terminalInput) {
        terminalInput = handler;
        return () => {
          terminalInput = undefined;
        };
      },
      theme,
    },
  } as ExtensionContext);
  terminalInput?.(`\u001b]10;${reply}\u0007`);
  await started;

  expect(terminalForeground(theme)).toEqual(expected);
});

test("does not query when custom-message text has an explicit color", async () => {
  let sessionStart:
    ((event: unknown, context: ExtensionContext) => Promise<void>) | undefined;
  let listenerRegistrations = 0;
  const writes: string[] = [];
  const theme = {
    getFgAnsi: () => "\u001b[38;2;212;212;212m",
  } as unknown as Theme;
  const pi = {
    on(event: string, handler: typeof sessionStart) {
      if (event === "session_start") sessionStart = handler;
    },
  } as ExtensionAPI;

  registerTerminalForegroundQuery(pi, {
    timeoutMs: 1,
    write: (data) => writes.push(data),
  });
  await sessionStart?.({ type: "session_start" }, {
    mode: "tui",
    ui: {
      onTerminalInput() {
        listenerRegistrations += 1;
        return () => {};
      },
      theme,
    },
  } as unknown as ExtensionContext);

  expect(writes).toEqual([]);
  expect(listenerRegistrations).toBe(0);
});

test("removes the terminal listener when writing the query fails", async () => {
  let sessionStart:
    ((event: unknown, context: ExtensionContext) => Promise<void>) | undefined;
  let terminalInput: ((data: string) => unknown) | undefined;
  const theme = {
    getFgAnsi: () => "\u001b[39m",
  } as unknown as Theme;
  const pi = {
    on(event: string, handler: typeof sessionStart) {
      if (event === "session_start") sessionStart = handler;
    },
  } as ExtensionAPI;

  registerTerminalForegroundQuery(pi, {
    timeoutMs: 100,
    write: () => {
      throw new Error("closed terminal");
    },
  });
  await sessionStart?.({ type: "session_start" }, {
    mode: "tui",
    ui: {
      onTerminalInput(handler: typeof terminalInput) {
        terminalInput = handler;
        return () => {
          terminalInput = undefined;
        };
      },
      theme,
    },
  } as ExtensionContext);

  expect(terminalInput).toBeUndefined();
});

test("removes the terminal listener after the query times out", async () => {
  vi.useFakeTimers();
  try {
    let sessionStart:
      | ((event: unknown, context: ExtensionContext) => Promise<void>)
      | undefined;
    let terminalInput: ((data: string) => unknown) | undefined;
    const theme = {
      getFgAnsi: () => "\u001b[39m",
    } as unknown as Theme;
    const pi = {
      on(event: string, handler: typeof sessionStart) {
        if (event === "session_start") sessionStart = handler;
      },
    } as ExtensionAPI;

    registerTerminalForegroundQuery(pi, { timeoutMs: 100, write: () => {} });
    const started = sessionStart?.({ type: "session_start" }, {
      mode: "tui",
      ui: {
        onTerminalInput(handler: typeof terminalInput) {
          terminalInput = handler;
          return () => {
            terminalInput = undefined;
          };
        },
        theme,
      },
    } as ExtensionContext);

    await vi.advanceTimersByTimeAsync(100);
    await started;
    expect(terminalInput).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});
