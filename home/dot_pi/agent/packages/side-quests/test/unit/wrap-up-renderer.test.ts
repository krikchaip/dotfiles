import {
  type EntryRenderer,
  type ExtensionAPI,
  type Theme,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import { beforeEach, expect, test, vi } from "vitest";

import type { ChildRuntime } from "../../child/runtime.ts";
import {
  WRAP_UP_MESSAGE_TYPE,
  type WrapUpEntryData,
  type WrapUpMarkdownTransformer,
  WrapUpRenderer,
} from "../../renderer/wrap-up-renderer.ts";

const theme = {
  bg: (color: string, text: string) => `<bg:${color}>${text}</bg>`,
  bold: (text: string) => `<bold>${text}</bold>`,
  fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
} as Theme;

beforeEach(() => {
  initTheme("dark", false);
});

function registeredRenderer() {
  let entryRenderer: EntryRenderer<WrapUpEntryData> | undefined;
  let transformer: WrapUpMarkdownTransformer | undefined;
  const shouldHideWrapUpResponse = vi.fn(() => true);
  const pi = {
    registerEntryRenderer(
      customType: string,
      registered: EntryRenderer<WrapUpEntryData>,
    ) {
      if (customType === WRAP_UP_MESSAGE_TYPE) entryRenderer = registered;
    },
    registerMarkdownTransformer(registered: WrapUpMarkdownTransformer) {
      transformer = registered;
    },
  } as unknown as ExtensionAPI;
  const runtime = {
    shouldHideWrapUpResponse,
  } as unknown as ChildRuntime;

  WrapUpRenderer.register(pi, runtime);

  return {
    entryRenderer: entryRenderer as EntryRenderer<WrapUpEntryData>,
    shouldHideWrapUpResponse,
    transformer: transformer as WrapUpMarkdownTransformer,
  };
}

test("renders the final Markdown inside one warning-colored WRAP UP banner", () => {
  const { entryRenderer } = registeredRenderer();
  const component = entryRenderer(
    {
      type: "custom",
      id: "wrap-up-entry",
      parentId: null,
      timestamp: new Date().toISOString(),
      customType: WRAP_UP_MESSAGE_TYPE,
      data: { content: "## Result\n\n- Verified in real tmux" },
    },
    { expanded: false },
    theme,
  );
  const rendered = component?.render(80).join("\n") ?? "";

  expect(rendered).toContain("<warning><bold>WRAP UP</bold></warning>");
  expect(rendered).toContain("<bg:customMessageBg>");
  expect(rendered).toContain("Result");
  expect(rendered).toContain("Verified in real tmux");
});

test("hides the native assistant rendering owned by the wrap-up banner", () => {
  const { shouldHideWrapUpResponse, transformer } = registeredRenderer();

  expect(
    transformer("Final handoff", {
      messageType: "assistant",
      isStreaming: false,
      availableWidth: 80,
    }),
  ).toBe("");
  expect(shouldHideWrapUpResponse).toHaveBeenCalledWith("Final handoff", false);

  expect(
    transformer("User prompt", {
      messageType: "user",
      isStreaming: false,
      availableWidth: 80,
    }),
  ).toBe("User prompt");
});

test("extracts only non-empty persisted wrap-up content", () => {
  expect(WrapUpRenderer.entryContent({ content: "  Final handoff  " })).toBe(
    "Final handoff",
  );
  expect(WrapUpRenderer.entryContent({ content: "  " })).toBeUndefined();
  expect(WrapUpRenderer.entryContent(undefined)).toBeUndefined();
});
