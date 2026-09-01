import { describe, expect, test } from "bun:test";
import { pruneManagedImagesForRequest } from "../prune-on-request";

function image(id: number) {
  return {
    type: "image",
    data: `bytes-${id}`,
    mimeType: "image/png",
    piImageMeta: { id, label: `Attached [#image ${id}]` },
  };
}

function imageIds(message: { content?: unknown }) {
  if (!Array.isArray(message.content)) return [];
  return message.content
    .filter((block: any) => block?.type === "image")
    .map((block: any) => block.piImageMeta?.id);
}

describe("pruneManagedImagesForRequest", () => {
  test("keeps active images on the submitted user message for the first request", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "Compare [#image 1] and [#image 2]" },
          image(1),
          image(2),
        ],
      },
    ];

    const result = pruneManagedImagesForRequest(messages);

    expect(result).toHaveLength(1);
    expect(imageIds(result[0]!)).toEqual([1, 2]);
  });

  test("moves active images after tool results for the next provider request", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "Compare [#image 1] and [#image 2]" },
          image(1),
          image(2),
        ],
      },
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call-1",
            name: "read",
            arguments: { path: "spec.md" },
          },
        ],
        stopReason: "toolUse",
      },
      {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "read",
        content: [{ type: "text", text: "spec" }],
      },
    ];

    const result = pruneManagedImagesForRequest(messages);

    expect(result).toHaveLength(4);
    expect(imageIds(result[0]!)).toEqual([]);
    expect(result[3]!.role).toBe("user");
    expect(imageIds(result[3]!)).toEqual([1, 2]);
  });

  test("does not restore unreferenced historical images during a tool loop", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "Old [#image 1]" },
          image(1),
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "Done" }] },
      {
        role: "user",
        content: [
          { type: "text", text: "Inspect [#image 2]" },
          image(2),
        ],
      },
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call-2",
            name: "read",
            arguments: { path: "notes.md" },
          },
        ],
        stopReason: "toolUse",
      },
      {
        role: "toolResult",
        toolCallId: "call-2",
        toolName: "read",
        content: [{ type: "text", text: "notes" }],
      },
    ];

    const result = pruneManagedImagesForRequest(messages);
    const allIds = result.flatMap(imageIds);

    expect(allIds).toEqual([2]);
    expect(imageIds(result.at(-1)!)).toEqual([2]);
  });
});
