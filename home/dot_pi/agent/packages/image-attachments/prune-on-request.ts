/**
 * Prune-on-request provider payload filter.
 *
 * Removes historical managed image bytes from provider context while
 * keeping the session file and visible transcript unchanged. The current request
 * keeps only the managed image bytes it references, deduped per provider call.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const INLINE_PLACEHOLDER_PATTERN = /\[#image ([1-9]\d*)\]/g;
const ATTACHED_LABEL_PATTERN = /^Attached \[#image ([1-9]\d*)\]$/;
const PLACEHOLDER_LABEL_PATTERN = /^\[#image ([1-9]\d*)\]$/;

type TextBlock = { type: "text"; text: string };

type ImageBlock = {
  type: "image";
  data?: string;
  mimeType?: string;
  piImageMeta?: { id?: number; label?: string; hash?: string };
};

type MessageLike = {
  role?: string;
  content?: unknown;
  [key: string]: unknown;
};

type ImageSource = {
  id: number;
  block: ImageBlock;
};

function isTextBlock(block: unknown): block is TextBlock {
  return !!block && typeof block === "object" && (block as any).type === "text";
}

function isImageBlock(block: unknown): block is ImageBlock {
  return (
    !!block && typeof block === "object" && (block as any).type === "image"
  );
}

function imageIdFromLabel(label: unknown): number | undefined {
  if (typeof label !== "string") return undefined;
  const attached = label.match(ATTACHED_LABEL_PATTERN);
  if (attached?.[1]) return Number(attached[1]);
  const placeholder = label.match(PLACEHOLDER_LABEL_PATTERN);
  if (placeholder?.[1]) return Number(placeholder[1]);
  return undefined;
}

function managedImageId(block: unknown): number | undefined {
  if (!isImageBlock(block) || !block.piImageMeta) return undefined;

  const id = block.piImageMeta.id;
  if (typeof id === "number" && Number.isInteger(id) && id > 0) return id;

  return imageIdFromLabel(block.piImageMeta.label);
}

function hasProviderBytes(block: ImageBlock): boolean {
  return typeof block.data === "string" && typeof block.mimeType === "string";
}

function cloneImageBlock(block: ImageBlock): ImageBlock {
  return {
    ...block,
    piImageMeta: block.piImageMeta ? { ...block.piImageMeta } : undefined,
  };
}

function hasAssistantToolCall(message: MessageLike): boolean {
  if (message.role !== "assistant" || !Array.isArray(message.content)) {
    return false;
  }

  return message.content.some(
    (block) =>
      !!block &&
      typeof block === "object" &&
      (block as any).type === "toolCall",
  );
}

function isFailedAssistantTail(message: MessageLike): boolean {
  return (
    message.role === "assistant" &&
    (message.stopReason === "error" || message.stopReason === "aborted")
  );
}

function isActiveTurnTail(message: MessageLike): boolean {
  return (
    message.role === "toolResult" ||
    hasAssistantToolCall(message) ||
    isFailedAssistantTail(message)
  );
}

function currentRequestGroupIndexes(messages: MessageLike[]): Set<number> {
  let index = messages.length - 1;

  while (index >= 0 && isActiveTurnTail(messages[index]!)) {
    index--;
  }

  const indexes = new Set<number>();
  while (index >= 0 && messages[index]?.role === "user") {
    indexes.add(index);
    index--;
  }

  return indexes;
}

function placeholderRefsFromText(text: string): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  const re = new RegExp(INLINE_PLACEHOLDER_PATTERN.source, "g");

  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const id = Number(match[1]);
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return ids;
}

function collectImageSources(
  messages: MessageLike[],
): Map<number, ImageSource> {
  const sources = new Map<number, ImageSource>();

  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;

    for (const block of message.content) {
      const id = managedImageId(block);
      if (!id || !isImageBlock(block) || !hasProviderBytes(block)) continue;

      sources.set(id, { id, block: cloneImageBlock(block) });
    }
  }

  return sources;
}

function collectCurrentTargets(
  messages: MessageLike[],
  currentGroup: Set<number>,
): Map<number, number> {
  const targets = new Map<number, number>();

  for (let index = 0; index < messages.length; index++) {
    if (!currentGroup.has(index)) continue;

    const message = messages[index]!;
    if (!Array.isArray(message.content)) continue;

    for (const block of message.content) {
      if (isTextBlock(block)) {
        for (const id of placeholderRefsFromText(block.text)) {
          if (!targets.has(id)) targets.set(id, index);
        }
        continue;
      }

      const id = managedImageId(block);
      if (id && !targets.has(id)) targets.set(id, index);
    }
  }

  return targets;
}

function appendImages(
  content: unknown[],
  imageIds: number[],
  sources: Map<number, ImageSource>,
): unknown[] {
  if (imageIds.length === 0) return content;

  const appended = [...content];
  for (const id of imageIds) {
    const source = sources.get(id);
    if (!source) continue;
    appended.push(cloneImageBlock(source.block));
  }
  return appended;
}

export function pruneManagedImagesForRequest<T extends MessageLike>(
  messages: T[],
): T[] {
  const currentGroup = currentRequestGroupIndexes(messages);
  if (currentGroup.size === 0) return messages;

  const sources = collectImageSources(messages);
  const targets = collectCurrentTargets(messages, currentGroup);
  if (targets.size === 0 && sources.size === 0) return messages;

  const imagesByTarget = new Map<number, number[]>();
  for (const [id, index] of targets) {
    if (!sources.has(id)) continue;
    const ids = imagesByTarget.get(index) ?? [];
    ids.push(id);
    imagesByTarget.set(index, ids);
  }

  let changed = false;
  const result = messages.map((message, index) => {
    if (message.role !== "user" || !Array.isArray(message.content)) {
      return message;
    }

    let messageChanged = false;
    const strippedContent: unknown[] = [];
    for (const block of message.content) {
      const id = managedImageId(block);
      if (id) {
        messageChanged = true;
        continue;
      }
      strippedContent.push(block);
    }

    const nextContent = appendImages(
      strippedContent,
      imagesByTarget.get(index) ?? [],
      sources,
    );

    messageChanged ||= nextContent !== strippedContent;
    changed ||= messageChanged;
    if (!messageChanged) return message;

    return { ...message, content: nextContent } as T;
  });

  return changed ? result : messages;
}

export function installPruneOnRequest(pi: ExtensionAPI) {
  pi.on("context", (event) => ({
    messages: pruneManagedImagesForRequest(
      event.messages as unknown as MessageLike[],
    ) as any,
  }));
}
