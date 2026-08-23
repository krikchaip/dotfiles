import {
  type ExtensionAPI,
  type Theme,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import { beforeEach, expect, test } from "vitest";

import { ContinuationRenderer } from "../../continuation-renderer.ts";

const plainTheme = {
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
} as Theme;
const markedTheme = {
  bg: (color: string, text: string) => `<bg:${color}>${text}</bg>`,
  bold: (text: string) => `<bold>${text}</bold>`,
  fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
} as Theme;

type MessageRenderer = Parameters<ExtensionAPI["registerMessageRenderer"]>[1];
type SessionStartHandler = (
  event: unknown,
  context: {
    sessionManager: { getBranch(): readonly unknown[] };
  },
) => void;

function continuationRenderer(
  historicalEntries: readonly unknown[] = [],
): MessageRenderer {
  let renderer: MessageRenderer | undefined;
  let sessionStart: SessionStartHandler | undefined;
  const pi = {
    on(event: string, handler: SessionStartHandler) {
      if (event === "session_start") sessionStart = handler;
    },
    registerMessageRenderer(customType: string, registered: MessageRenderer) {
      if (customType === "side-quest-continuation") renderer = registered;
    },
  } as unknown as ExtensionAPI;

  ContinuationRenderer.register(pi);
  sessionStart?.(
    {},
    { sessionManager: { getBranch: () => historicalEntries } },
  );
  expect(renderer).toBeDefined();

  return renderer as MessageRenderer;
}

function renderContinuation(options: {
  readonly expanded?: boolean;
  readonly historicalEntries?: readonly unknown[];
  readonly question?: string;
  readonly reply: string;
  readonly requestId?: string;
  readonly responseId?: string;
  readonly theme?: Theme;
}): string {
  const component = continuationRenderer(options.historicalEntries)(
    {
      role: "custom",
      customType: "side-quest-continuation",
      content: options.reply,
      display: true,
      details: {
        requestId:
          options.requestId ?? (options.question ? "request-id" : undefined),
        responseId: options.responseId,
        question: options.question,
      },
      timestamp: 0,
    },
    { expanded: options.expanded ?? false, outputPad: 0 },
    options.theme ?? plainTheme,
  );

  return component?.render(500).join("\n") ?? "";
}

beforeEach(() => {
  initTheme("dark", false);
});

test("correlated parent answers render layout A with muted question context first", () => {
  const rendered = renderContinuation({
    question: "Which color should I use?",
    reply: "Use blue.",
  });
  const lines = rendered.split("\n").map((line) => line.trim());
  const heading = lines.indexOf("FROM PARENT");
  const question = lines.indexOf("Which color should I use?");
  const reply = lines.indexOf("Use blue.");

  expect(heading).toBeGreaterThanOrEqual(0);
  expect(question).toBe(heading + 1);
  expect(reply).toBeGreaterThan(question + 1);
});

test("historical correlated answers recover question context from the active branch", () => {
  const question = "Should the compact view show elapsed time?";
  const responseId = "gallery-answer";
  const historicalEntries = [
    {
      type: "message",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "ask-parent-success",
            name: "ask_parent",
            arguments: { prompt: question },
          },
        ],
      },
    },
    {
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "ask-parent-success",
        toolName: "ask_parent",
        isError: false,
      },
    },
    {
      type: "custom_message",
      customType: "side-quest-continuation",
      details: {
        requestId: "gallery-question",
        responseId,
      },
    },
  ];
  const rendered = renderContinuation({
    historicalEntries,
    reply: "Yes. Keep elapsed time.",
    requestId: "gallery-question",
    responseId,
  });

  expect(rendered).toContain(question);
});

test("direct parent continuations render without question context", () => {
  const rendered = renderContinuation({
    reply: "Apply the active continuation now.",
  });
  const lines = rendered.split("\n").map((line) => line.trim());
  const heading = lines.indexOf("FROM PARENT");
  const reply = lines.indexOf("Apply the active continuation now.");

  expect(heading).toBeGreaterThanOrEqual(0);
  expect(reply).toBeGreaterThan(heading + 1);
  expect(rendered).not.toContain("YOUR QUESTION");
  expect(rendered).not.toContain("IN RESPONSE TO");
});

test("collapsed parent answers truncate long questions and replies independently", () => {
  const question = `${"問".repeat(240)}🤖`;
  const reply = `${"R".repeat(240)}Z`;
  const rendered = renderContinuation({ question, reply, theme: markedTheme });

  expect(rendered).toContain(`<muted>${"問".repeat(240)}`);
  expect(rendered).not.toContain("🤖");
  expect(rendered).toContain(
    `<customMessageText>${"R".repeat(240)}</customMessageText>`,
  );
  expect(rendered).not.toContain(`${"R".repeat(240)}Z`);
  expect(rendered.match(/to expand/g)).toHaveLength(2);
  expect(rendered).toContain("<bg:customMessageBg>");
  expect(rendered).toContain(
    "<customMessageLabel><bold>FROM PARENT</bold></customMessageLabel>",
  );
  expect(rendered).toMatch(
    /<muted>… <\/muted><dim>[^<]*<\/dim><muted> to expand<\/muted>/,
  );
});

test("expanded parent answers show complete questions and replies without hints", () => {
  const question = `${"Q".repeat(240)}Z`;
  const reply = `${"R".repeat(240)}Z`;
  const rendered = renderContinuation({ expanded: true, question, reply });

  expect(rendered).toContain(question);
  expect(rendered).toContain(reply);
  expect(rendered).not.toContain("to expand");
});
