/**
 * Transient provider labels.
 *
 * Injects `Attached [#image N]` text blocks only for provider context so the
 * session transcript stays clean while models still receive stable labels.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ATTACHED_LABEL_PATTERN = /^Attached \[#image ([1-9]\d*)\]$/;
const PLACEHOLDER_PATTERN = /^\[#image ([1-9]\d*)\]$/;

type TextBlock = { type: "text"; text: string };

type ImageBlock = {
  type: "image";
  data?: string;
  mimeType?: string;
  piImageMeta?: { id?: number; label?: string; hash?: string };
};

function isTextBlock(block: unknown): block is TextBlock {
  return !!block && typeof block === "object" && (block as any).type === "text";
}

function isImageBlock(block: unknown): block is ImageBlock {
  return (
    !!block && typeof block === "object" && (block as any).type === "image"
  );
}

function labelFromImage(block: ImageBlock, index: number): string {
  const meta = block.piImageMeta;
  if (
    typeof meta?.id === "number" &&
    Number.isInteger(meta.id) &&
    meta.id > 0
  ) {
    return `Attached [#image ${meta.id}]`;
  }
  if (typeof meta?.label === "string") {
    if (ATTACHED_LABEL_PATTERN.test(meta.label)) return meta.label;
    if (PLACEHOLDER_PATTERN.test(meta.label)) return `Attached ${meta.label}`;
  }
  return `Attached [#image ${index + 1}]`;
}

function withTransientImageLabels(message: any): any {
  if (message?.role !== "user" || !Array.isArray(message.content))
    return message;

  let changed = false;
  let imageIndex = 0;
  const content: unknown[] = [];

  for (const block of message.content) {
    if (isImageBlock(block) && block.piImageMeta) {
      const label = labelFromImage(block, imageIndex);
      const previous = content[content.length - 1];
      if (!isTextBlock(previous) || previous.text !== label) {
        content.push({ type: "text", text: label });
        changed = true;
      }
      content.push(block);
      imageIndex++;
      continue;
    }

    content.push(block);
  }

  return changed ? { ...message, content } : message;
}

export function installTransientLabels(pi: ExtensionAPI) {
  pi.on("context", (event) => ({
    messages: event.messages.map((message) =>
      withTransientImageLabels(message),
    ),
  }));
}
