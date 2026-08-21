/**
 * Verifies the Agent renderer adapter against Pi's mutable tool-row prototype.
 *
 * These tests cover renderer-stack composition. Display-rule tests live in
 * `agent-renderer.test.ts`.
 */

import {
  type ExtensionAPI,
  type Theme,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, expect, test } from "vitest";

import { AgentRenderer } from "../../agent-renderer.ts";

const PATCH_STATE = Symbol.for("side-quests:agent-renderer-state");

type Renderer = (...args: unknown[]) => unknown;
type RendererOwner = {
  isPartial?: boolean;
  result?: { isError?: boolean };
  toolName?: string;
};
type RendererGetter = (this: RendererOwner) => unknown;
type Prototype = Record<PropertyKey, unknown>;

const prototype = ToolExecutionComponent.prototype as unknown as Prototype;
const originalDescriptors = new Map<
  PropertyKey,
  PropertyDescriptor | undefined
>();
const trackedProperties = [
  "getCallRenderer",
  "getResultRenderer",
  "hasRendererDefinition",
] as const;
const globals = globalThis as typeof globalThis & Record<PropertyKey, unknown>;
const theme = {
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
} as Theme;
const styledTheme = {
  bold: (text: string) => `\u001B[1m${text}\u001B[22m`,
  fg: (color: string, text: string) => `\u001B[${color}m${text}\u001B[39m`,
} as Theme;

function baseCallGetter(this: RendererOwner): Renderer {
  const toolName = this.toolName;
  return (args: unknown) => ({ args, source: "base", toolName });
}

function baseResultGetter(this: RendererOwner): Renderer {
  const toolName = this.toolName;
  return (result: unknown) => ({ result, source: "base", toolName });
}

function installBaseRenderers(): void {
  prototype.getCallRenderer = baseCallGetter;
  prototype.getResultRenderer = baseResultGetter;
  prototype.hasRendererDefinition = function hasRendererDefinition() {
    return false;
  };
}

function rendererFor(
  property: "getCallRenderer" | "getResultRenderer",
  owner: RendererOwner,
): Renderer | undefined {
  const getter = prototype[property] as RendererGetter;
  return getter.call(owner) as Renderer | undefined;
}

function renderedText(value: unknown): string {
  expect(value).toBeInstanceOf(Text);
  return (value as Text).render(200).join("\n");
}

beforeEach(() => {
  for (const property of trackedProperties)
    originalDescriptors.set(
      property,
      Object.getOwnPropertyDescriptor(prototype, property),
    );
  delete globals[PATCH_STATE];
  installBaseRenderers();
});

afterEach(() => {
  delete globals[PATCH_STATE];
  for (const property of trackedProperties) {
    const descriptor = originalDescriptors.get(property);
    if (descriptor) Object.defineProperty(prototype, property, descriptor);
    else delete prototype[property];
  }
  originalDescriptors.clear();
});

test("register installs independently", () => {
  let sessionStart:
    ((event: unknown, context: { mode: string }) => void) | undefined;
  const pi = {
    on(event: string, handler: typeof sessionStart) {
      if (event === "session_start") sessionStart = handler;
    },
  } as ExtensionAPI;

  AgentRenderer.register(pi);
  expect(sessionStart).toBeTypeOf("function");

  const hasRenderer = prototype.hasRendererDefinition as RendererGetter;
  expect(hasRenderer.call({ toolName: "Agent" })).toBe(true);
  expect(hasRenderer.call({ toolName: "unknown" })).toBe(false);

  const renderer = rendererFor("getCallRenderer", { toolName: "Agent" });
  expect(
    renderedText(
      renderer?.(
        {
          description: "standalone renderer",
          prompt: "Render it.",
          subagent_type: "general-purpose",
        },
        theme,
        { isPartial: false },
      ),
    ),
  ).toContain("● Agent general-purpose :: standalone renderer");

  const styled = renderedText(
    renderer?.(
      {
        description: "standalone renderer",
        prompt: "Render it.",
        subagent_type: "general-purpose",
      },
      styledTheme,
      { isPartial: false },
    ),
  );
  expect(styled).toContain(
    "\u001B[accentmgeneral-purpose :: standalone renderer\u001B[39m",
  );

  const pending = renderedText(
    renderer?.(
      {
        description: "pending renderer",
        prompt: "Keep working.",
        subagent_type: "general-purpose",
      },
      styledTheme,
      { isPartial: true },
    ),
  );
  expect(pending).toContain("\u001B[successm●\u001B[39m");
  expect(pending).not.toContain("\u001B[successm·\u001B[39m");
});

test("Agent calls expose canonical text to transcript composers", () => {
  expect(AgentRenderer.install()).toBe(true);

  const renderer = rendererFor("getCallRenderer", { toolName: "Agent" });
  const rendered = renderer?.(
    {
      description: "grouped renderer",
      prompt: "Render it.",
      subagent_type: "general-purpose",
    },
    theme,
    { isPartial: true },
  ) as (Text & { value?: string }) | undefined;

  expect(rendered?.value).toBe("● Agent general-purpose :: grouped renderer");
  expect(renderedText(rendered)).toContain(
    "● Agent general-purpose :: grouped renderer",
  );
});

test("Agent results render independently while other tools stay delegated", () => {
  expect(AgentRenderer.install()).toBe(true);
  const path = "/tmp/standalone/session.jsonl";
  const agentRenderer = rendererFor("getResultRenderer", {
    result: { isError: false },
    toolName: "Agent",
  });
  const rendered = agentRenderer?.(
    { content: [], details: { sessionPath: path } },
    { expanded: true, isPartial: false },
    theme,
    {
      args: {
        description: "standalone result",
        inherit_context: false,
        interactive: true,
        prompt: "Check both extension modes.",
      },
      isError: false,
    },
  );
  const text = renderedText(rendered);
  expect(text).toContain("inherit_context: false · interactive: true");
  expect(text).toContain(`session path: ${path}`);
  expect(text).toContain("Check both extension modes.");

  const styled = renderedText(
    agentRenderer?.(
      { content: [], details: { sessionPath: path } },
      { expanded: true, isPartial: false },
      styledTheme,
      {
        args: {
          description: "standalone result",
          inherit_context: false,
          interactive: true,
          prompt: "Check both extension modes.",
        },
        isError: false,
      },
    ),
  );
  expect(styled).toContain(
    "\u001B[dimminherit_context: false · interactive: true\u001B[39m",
  );
  expect(styled).toContain(`\u001B[dimmsession path: ${path}\u001B[39m`);
  expect(styled).toContain("\u001B[dimmCheck both extension modes.\u001B[39m");

  expect(
    rendererFor("getResultRenderer", {
      result: { isError: false },
      toolName: "read",
    })?.({ content: [] }),
  ).toEqual({ result: { content: [] }, source: "base", toolName: "read" });
});

test("Agent errors stay delegated to the active renderer stack", () => {
  expect(AgentRenderer.install()).toBe(true);
  const error = { content: [{ type: "text", text: "Synthetic failure." }] };
  expect(
    rendererFor("getResultRenderer", {
      result: { isError: true },
      toolName: "Agent",
    })?.(error),
  ).toEqual({ result: error, source: "base", toolName: "Agent" });
});

test("installation is idempotent and recovers after another renderer loads", () => {
  expect(AgentRenderer.install()).toBe(true);
  const firstCallAdapter = prototype.getCallRenderer;
  const firstResultAdapter = prototype.getResultRenderer;

  expect(AgentRenderer.install()).toBe(true);
  expect(prototype.getCallRenderer).toBe(firstCallAdapter);
  expect(prototype.getResultRenderer).toBe(firstResultAdapter);

  const externalCallGetter: RendererGetter = function externalCallGetter() {
    return () => ({ source: "external" });
  };
  const externalResultGetter: RendererGetter = function externalResultGetter() {
    return () => ({ source: "external" });
  };
  prototype.getCallRenderer = externalCallGetter;
  prototype.getResultRenderer = externalResultGetter;

  expect(AgentRenderer.install()).toBe(true);
  expect(prototype.getCallRenderer).not.toBe(externalCallGetter);
  expect(prototype.getResultRenderer).not.toBe(externalResultGetter);
  expect(rendererFor("getCallRenderer", { toolName: "read" })?.({})).toEqual({
    source: "external",
  });
  expect(
    rendererFor("getResultRenderer", {
      result: { isError: true },
      toolName: "Agent",
    })?.({}),
  ).toEqual({ source: "external" });
});
