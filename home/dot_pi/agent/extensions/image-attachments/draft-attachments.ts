/**
 * Draft image attachment lifecycle.
 *
 * Owns the draft attachment store, Ctrl-V/drag-drop image insertion, prompt
 * history restoration, and submit-time conversion from [#image N] placeholders
 * into Pi image blocks.
 */

import {
  AgentSession,
  InteractiveMode,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Editor } from "@earendil-works/pi-tui";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const PROMPT_PATCH_STATE = Symbol.for(
  "pi-image-attachments.prompt-content.patch",
);
const PASTE_PATCH_STATE = Symbol.for("pi-image-attachments.paste.patch");
const HISTORY_PATCH_STATE = Symbol.for("pi-image-attachments.history.patch");
const LEGACY_EDITOR_PATCH_STATE = Symbol.for(
  "pi-image-attachments.editor.patch",
);

const INLINE_PLACEHOLDER_PATTERN = /\[#image ([1-9]\d*)\]/g;
const ATTACHED_LABEL_PATTERN = /^Attached \[#image ([1-9]\d*)\]$/;
const CLIPBOARD_IMAGE_PATH_PATTERN =
  /(^|[\s"'`([{<])((?:\/[^\s"'`()\[\]{}<>]+)*\/pi-clipboard-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(?:png|jpe?g|gif|webp))(?=$|[\s"'`)\]}>,.!?;:])/g;
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
]);
const UNSUPPORTED_IMAGE_LIKE_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".heic",
  ".heif",
  ".tif",
  ".tiff",
]);

export type DraftAttachment = {
  id: number;
  data: string;
  mimeType: string;
  hash: string;
};

type DraftStoreSnapshot = {
  items: DraftAttachment[];
  nextId: number;
  persistedMax: number;
};

type DraftReconcileResult = {
  text: string;
  textChanged: boolean;
  idMap: Map<number, number>;
};

type TextBlock = { type: "text"; text: string };

type ImageBlock = {
  type: "image";
  data?: string;
  mimeType?: string;
  piImageMeta?: { id?: number; label?: string; hash?: string };
};

type PromptPatchState = {
  originalRunAgentPrompt: (messages: any) => Promise<void>;
};

type PastePatchState = {
  originalHandleClipboardImagePaste?: () => Promise<void>;
};

type HistoryPatchState = {
  originalPushUndoSnapshot: () => void;
  originalUndo: () => void;
  originalAddToHistory: (text: string) => void;
  originalNavigateHistory: (direction: number) => void;
  originalExitHistoryBrowsing: () => void;
};

export type ImageAttachmentsDrafts = {
  activePlaceholderSpans(text: string): Array<{
    id: number;
    start: number;
    end: number;
  }>;
  hasImageSubmitIntent(text: string): boolean;
  placeholderIdAtCursor(editor: any): number | undefined;
  previewImagesForText(text: string): DraftAttachment[];
  reconcileEditorDraft(editor: any): void;
  setActiveEditor(editor: any): void;
};

class DraftStore {
  private items = new Map<number, DraftAttachment>();
  private _nextId = 1;
  private persistedMax = 0;

  reset(persistedMax: number): void {
    this.items.clear();
    this.persistedMax = persistedMax;
    this._nextId = persistedMax + 1;
  }

  add(data: string, mimeType: string, hash: string): DraftAttachment {
    const id = this._nextId++;
    const item: DraftAttachment = { id, data, mimeType, hash };
    this.items.set(id, item);
    return item;
  }

  get(id: number): DraftAttachment | undefined {
    return this.items.get(id);
  }

  has(id: number): boolean {
    return this.items.has(id);
  }

  markSubmitted(ids: number[]): void {
    for (const id of ids) {
      this.items.delete(id);
      this.persistedMax = Math.max(this.persistedMax, id);
    }
    if (this.items.size === 0) this._nextId = this.persistedMax + 1;
  }

  clearDraft(): void {
    this.items.clear();
    this._nextId = this.persistedMax + 1;
  }

  snapshot(): DraftStoreSnapshot {
    return {
      items: [...this.items.values()].map((item) => ({ ...item })),
      nextId: this._nextId,
      persistedMax: this.persistedMax,
    };
  }

  snapshotForText(text: string): DraftStoreSnapshot | undefined {
    const activeIds = new Set(this.activeForText(text).map((item) => item.id));
    if (activeIds.size === 0) return undefined;

    const snapshot = this.snapshot();
    return {
      ...snapshot,
      items: snapshot.items.filter((item) => activeIds.has(item.id)),
    };
  }

  restore(snapshot: DraftStoreSnapshot): void {
    this.items = new Map(snapshot.items.map((item) => [item.id, { ...item }]));
    this._nextId = snapshot.nextId;
    this.persistedMax = snapshot.persistedMax;
  }

  restoreForHistoryText(
    text: string,
    snapshot: DraftStoreSnapshot,
  ): DraftReconcileResult {
    const snapshotItems = new Map(
      snapshot.items.map((item) => [item.id, { ...item }]),
    );
    const seen = new Set<number>();
    const activeIds: number[] = [];
    const re = new RegExp(INLINE_PLACEHOLDER_PATTERN.source, "g");

    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const id = Number(m[1]);
      if (seen.has(id) || !snapshotItems.has(id)) continue;
      seen.add(id);
      activeIds.push(id);
    }

    activeIds.sort((a, b) => a - b);

    const idMap = new Map<number, number>();
    const nextItems = new Map<number, DraftAttachment>();
    const baseId = this.persistedMax + 1;

    for (let i = 0; i < activeIds.length; i++) {
      const oldId = activeIds[i]!;
      const nextId = baseId + i;
      const item = snapshotItems.get(oldId);
      if (!item) continue;
      idMap.set(oldId, nextId);
      nextItems.set(nextId, { ...item, id: nextId });
    }

    const newText = text.replace(INLINE_PLACEHOLDER_PATTERN, (token, rawId) => {
      const nextId = idMap.get(Number(rawId));
      return nextId ? `[#image ${nextId}]` : token;
    });

    this.items = nextItems;
    this._nextId = baseId + nextItems.size;

    return { text: newText, textChanged: newText !== text, idMap };
  }

  reconcileText(text: string): DraftReconcileResult {
    const seen = new Set<number>();
    const activeIds: number[] = [];
    const re = new RegExp(INLINE_PLACEHOLDER_PATTERN.source, "g");

    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const id = Number(m[1]);
      if (seen.has(id) || !this.items.has(id)) continue;
      seen.add(id);
      activeIds.push(id);
    }

    activeIds.sort((a, b) => a - b);

    const idMap = new Map<number, number>();
    const nextItems = new Map<number, DraftAttachment>();
    const baseId = this.persistedMax + 1;

    for (let i = 0; i < activeIds.length; i++) {
      const oldId = activeIds[i]!;
      const nextId = baseId + i;
      const item = this.items.get(oldId);
      if (!item) continue;
      idMap.set(oldId, nextId);
      nextItems.set(nextId, { ...item, id: nextId });
    }

    const newText = text.replace(INLINE_PLACEHOLDER_PATTERN, (token, rawId) => {
      const oldId = Number(rawId);
      const nextId = idMap.get(oldId);
      return nextId ? `[#image ${nextId}]` : token;
    });

    this.items = nextItems;
    this._nextId = baseId + nextItems.size;

    return { text: newText, textChanged: newText !== text, idMap };
  }

  activeForText(text: string): DraftAttachment[] {
    const seen = new Set<number>();
    const ids: number[] = [];
    const re = new RegExp(INLINE_PLACEHOLDER_PATTERN.source, "g");

    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const id = Number(m[1]);
      if (seen.has(id) || !this.items.has(id)) continue;

      seen.add(id);
      ids.push(id);
    }

    return ids
      .sort((a, b) => a - b)
      .flatMap((id) => {
        const item = this.items.get(id);
        return item ? [item] : [];
      });
  }
}

const draftStore = new DraftStore();
const submittedImages = new Map<number, DraftAttachment>();
const pendingSubmittedDraftIds = new Set<number>();
let nextDraftUndoSnapshot: DraftStoreSnapshot | undefined;
let unsubscribeDragDrop: (() => void) | undefined;
let activeEditorInstance: any = undefined;

const editorDraftUndo = new WeakMap<object, DraftStoreSnapshot[]>();
const editorHistoryDrafts = new WeakMap<
  object,
  Array<DraftStoreSnapshot | undefined>
>();
const editorHistoryBrowseDraft = new WeakMap<object, DraftStoreSnapshot>();

function isTextBlock(block: unknown): block is TextBlock {
  return !!block && typeof block === "object" && (block as any).type === "text";
}

function isImageBlock(block: unknown): block is ImageBlock {
  return (
    !!block && typeof block === "object" && (block as any).type === "image"
  );
}

function idFromAttachedLabel(text: string): number | undefined {
  const match = ATTACHED_LABEL_PATTERN.exec(text.trim());
  if (!match) return undefined;

  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

function removeAttachedLabelLines(text: string, labels: string[]): string {
  const kept: string[] = [];

  for (const line of text.split(/\r?\n/)) {
    const label = line.trim();
    if (idFromAttachedLabel(label)) {
      labels.push(label);
      continue;
    }
    kept.push(line);
  }

  return kept.join("\n");
}

function idFromImage(block: ImageBlock): number | undefined {
  const id = block.piImageMeta?.id;
  if (typeof id === "number" && Number.isInteger(id) && id > 0) return id;

  const label = block.piImageMeta?.label;
  return typeof label === "string" ? idFromAttachedLabel(label) : undefined;
}

function messageList(messages: unknown): unknown[] {
  return Array.isArray(messages) ? messages : [messages];
}

function maxSubmittedImageId(messages: unknown): number {
  let max = 0;

  for (const message of messageList(messages)) {
    const content = (message as any)?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (isTextBlock(block)) {
        const labels: string[] = [];
        removeAttachedLabelLines(block.text, labels);
        for (const label of labels) {
          const id = idFromAttachedLabel(label);
          if (id) max = Math.max(max, id);
        }
        continue;
      }

      if (!isImageBlock(block)) continue;
      const id = idFromImage(block);
      if (id) max = Math.max(max, id);
    }
  }

  return max;
}

function rememberSubmittedImages(messages: unknown, clear = false): void {
  if (clear) submittedImages.clear();

  for (const message of messageList(messages)) {
    const content = (message as any)?.content;
    if (!Array.isArray(content)) continue;

    const pendingIds: number[] = [];
    for (const block of content) {
      if (isTextBlock(block)) {
        const labels: string[] = [];
        removeAttachedLabelLines(block.text, labels);
        for (const label of labels) {
          const id = idFromAttachedLabel(label);
          if (id) pendingIds.push(id);
        }
        continue;
      }

      if (!isImageBlock(block)) continue;
      const id = idFromImage(block) ?? pendingIds.shift();
      if (id && pendingIds[0] === id) pendingIds.shift();
      if (!id || !block.data || !block.mimeType) continue;

      submittedImages.set(id, {
        id,
        data: block.data,
        mimeType: block.mimeType,
        hash:
          block.piImageMeta?.hash ?? `${block.mimeType}:${block.data.length}`,
      });
    }
  }
}

function submittedImagesForText(text: string): DraftAttachment[] {
  const seen = new Set<number>();
  const ids: number[] = [];
  const re = new RegExp(INLINE_PLACEHOLDER_PATTERN.source, "g");

  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const id = Number(m[1]);
    if (seen.has(id) || !submittedImages.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return ids
    .sort((a, b) => a - b)
    .flatMap((id) => {
      const item = submittedImages.get(id);
      return item ? [item] : [];
    });
}

function previewImagesForText(text: string): DraftAttachment[] {
  const byId = new Map<number, DraftAttachment>();
  for (const item of draftStore.activeForText(text)) byId.set(item.id, item);
  for (const item of submittedImagesForText(text)) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

function hasActiveImageId(id: number): boolean {
  return draftStore.has(id) || submittedImages.has(id);
}

function submittedImagesCoverSnapshotText(
  text: string,
  snapshot: DraftStoreSnapshot,
): boolean {
  const snapshotIds = new Set(snapshot.items.map((item) => item.id));
  if (snapshotIds.size === 0) return false;

  const matchedIds = new Set<number>();
  const re = new RegExp(INLINE_PLACEHOLDER_PATTERN.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const id = Number(m[1]);
    if (snapshotIds.has(id)) matchedIds.add(id);
  }

  return (
    matchedIds.size > 0 &&
    [...matchedIds].every((id) => submittedImages.has(id))
  );
}

function detectSupportedMimeType(
  filePath: string,
  bytes: Buffer,
): string | undefined {
  const ext = extname(filePath).toLowerCase();

  if (
    ext === ".png" &&
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    (ext === ".jpg" || ext === ".jpeg") &&
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    ext === ".gif" &&
    bytes.length >= 6 &&
    (bytes.subarray(0, 6).toString("ascii") === "GIF87a" ||
      bytes.subarray(0, 6).toString("ascii") === "GIF89a")
  ) {
    return "image/gif";
  }
  if (
    ext === ".webp" &&
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  return undefined;
}

function loadImageFromPath(filePath: string):
  | {
      data: string;
      hash: string;
      mimeType: string;
    }
  | undefined {
  try {
    const bytes = readFileSync(filePath);
    const mimeType = detectSupportedMimeType(filePath, bytes);
    if (!mimeType) return undefined;
    return {
      data: bytes.toString("base64"),
      hash: createHash("sha256").update(bytes).digest("hex"),
      mimeType,
    };
  } catch {
    return undefined;
  }
}

function hasActiveImagePlaceholder(text: string): boolean {
  const re = new RegExp(INLINE_PLACEHOLDER_PATTERN.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (hasActiveImageId(Number(m[1]))) return true;
  }
  return false;
}

function hasConvertibleClipboardImagePath(text: string): boolean {
  const re = new RegExp(CLIPBOARD_IMAGE_PATH_PATTERN.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const path = m[2];
    if (path && loadImageFromPath(path)) return true;
  }
  return false;
}

function hasImageSubmitIntent(text: string): boolean {
  return (
    hasActiveImagePlaceholder(text) || hasConvertibleClipboardImagePath(text)
  );
}

function activePlaceholderSpans(text: string): Array<{
  id: number;
  start: number;
  end: number;
}> {
  const spans: Array<{ id: number; start: number; end: number }> = [];
  const re = new RegExp(INLINE_PLACEHOLDER_PATTERN.source, "g");

  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const id = Number(m[1]);
    if (!hasActiveImageId(id)) continue;
    spans.push({ id, start: m.index, end: m.index + m[0].length });
  }

  return spans;
}

function placeholderIdAtCursor(editor: any): number | undefined {
  const line = editor?.state?.lines?.[editor?.state?.cursorLine ?? 0] ?? "";
  const col = editor?.state?.cursorCol ?? 0;
  const re = new RegExp(INLINE_PLACEHOLDER_PATTERN.source, "g");

  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const end = m.index + m[0].length;
    if (col >= m.index && col < end) return Number(m[1]);
  }

  return undefined;
}

function absoluteCursorOffset(editor: any): number {
  const lines = editor?.state?.lines;
  const cursorLine = editor?.state?.cursorLine ?? 0;
  const cursorCol = editor?.state?.cursorCol ?? 0;
  if (!Array.isArray(lines)) return 0;

  let offset = 0;
  for (let i = 0; i < cursorLine; i++) offset += (lines[i] ?? "").length + 1;
  return offset + cursorCol;
}

function lineColFromOffset(
  text: string,
  offset: number,
): { line: number; col: number } {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, safeOffset).split("\n");
  return {
    line: before.length - 1,
    col: before[before.length - 1]?.length ?? 0,
  };
}

function adjustCursorOffset(
  text: string,
  offset: number,
  idMap: Map<number, number>,
): number {
  let adjusted = offset;
  const re = new RegExp(INLINE_PLACEHOLDER_PATTERN.source, "g");

  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index >= offset) break;

    const nextId = idMap.get(Number(m[1]));
    if (!nextId) continue;

    const oldLength = m[0].length;
    const newLength = `[#image ${nextId}]`.length;
    const end = m.index + oldLength;

    if (end <= offset) adjusted += newLength - oldLength;
    else adjusted = m.index + newLength;
  }

  return adjusted;
}

function setEditorTextWithoutUndo(
  editor: any,
  text: string,
  cursorOffset: number,
): void {
  const lines = text.split("\n");
  const cursor = lineColFromOffset(text, cursorOffset);

  editor.state.lines = lines.length === 0 ? [""] : lines;
  editor.state.cursorLine = Math.max(
    0,
    Math.min(cursor.line, editor.state.lines.length - 1),
  );
  editor.state.cursorCol = Math.max(
    0,
    Math.min(
      cursor.col,
      editor.state.lines[editor.state.cursorLine]?.length ?? 0,
    ),
  );
  editor.preferredVisualCol = null;
  editor.snappedFromCursorCol = null;
  editor.scrollOffset = 0;
  editor.onChange?.(editor.getText());
}

function reconcileEditorDraft(editor: any): void {
  if (!editor?.getText || !editor?.state) return;

  const oldText = editor.getText();
  const oldOffset = absoluteCursorOffset(editor);
  const result = draftStore.reconcileText(oldText);
  if (!result.textChanged) return;

  setEditorTextWithoutUndo(
    editor,
    result.text,
    adjustCursorOffset(oldText, oldOffset, result.idMap),
  );
  editor.tui?.requestRender?.();
}

function addDraftAttachment(
  data: string,
  mimeType: string,
  hash: string,
): DraftAttachment {
  nextDraftUndoSnapshot = draftStore.snapshot();
  return draftStore.add(data, mimeType, hash);
}

function imageBlockFromDraft(id: number, draft: DraftAttachment): ImageBlock {
  return {
    type: "image",
    data: draft.data,
    mimeType: draft.mimeType,
    piImageMeta: {
      id,
      label: `Attached [#image ${id}]`,
      hash: draft.hash,
    },
  };
}

function draftImagesForText(text: string): {
  images: ImageBlock[];
  submittedIds: number[];
} {
  const seen = new Set<number>();
  const ids: number[] = [];
  const re = new RegExp(INLINE_PLACEHOLDER_PATTERN.source, "g");

  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const id = Number(m[1]);
    if (seen.has(id) || !draftStore.get(id)) continue;

    seen.add(id);
    ids.push(id);
  }

  const submittedIds = ids.sort((a, b) => a - b);
  const images = submittedIds.flatMap((id) => {
    const draft = draftStore.get(id);
    return draft ? [imageBlockFromDraft(id, draft)] : [];
  });

  return { images, submittedIds };
}

function submittedImageBlocksForText(text: string): ImageBlock[] {
  const seen = new Set<number>();
  const ids: number[] = [];
  const re = new RegExp(INLINE_PLACEHOLDER_PATTERN.source, "g");

  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const id = Number(m[1]);
    if (seen.has(id) || !submittedImages.has(id)) continue;

    seen.add(id);
    ids.push(id);
  }

  return ids
    .sort((a, b) => a - b)
    .flatMap((id) => {
      const image = submittedImages.get(id);
      return image ? [imageBlockFromDraft(id, image)] : [];
    });
}

function transformDraftPlaceholders(message: any): {
  count: number;
  submittedIds: number[];
  message: any;
} {
  if (message?.role !== "user" || !Array.isArray(message.content)) {
    return { count: 0, submittedIds: [], message };
  }

  const existingIds = new Set<number>();
  for (const block of message.content) {
    if (!isImageBlock(block)) continue;
    const id = idFromImage(block);
    if (id) existingIds.add(id);
  }

  let count = 0;
  const submittedIds: number[] = [];
  const content: Array<TextBlock | ImageBlock | unknown> = [];

  for (const block of message.content) {
    if (!isTextBlock(block)) {
      content.push(block);
      continue;
    }

    const result = draftImagesForText(block.text);
    const images = result.images.filter((image) => {
      const id = idFromImage(image);
      return id === undefined || !existingIds.has(id);
    });

    content.push(block);
    for (const image of images) content.push(image);

    for (const id of result.submittedIds) {
      if (existingIds.has(id)) continue;
      existingIds.add(id);
      submittedIds.push(id);
      count++;
    }
  }

  return count === 0
    ? { count, submittedIds, message }
    : { count, submittedIds, message: { ...message, content } };
}

function transformSubmittedPlaceholders(message: any): {
  count: number;
  message: any;
} {
  if (message?.role !== "user" || !Array.isArray(message.content)) {
    return { count: 0, message };
  }

  const existingIds = new Set<number>();
  for (const block of message.content) {
    if (!isImageBlock(block)) continue;
    const id = idFromImage(block);
    if (id) existingIds.add(id);
  }

  let count = 0;
  const content: Array<TextBlock | ImageBlock | unknown> = [];

  for (const block of message.content) {
    if (!isTextBlock(block)) {
      content.push(block);
      continue;
    }

    const images = submittedImageBlocksForText(block.text).filter((image) => {
      const id = idFromImage(image);
      return id === undefined || !existingIds.has(id);
    });

    content.push(block);
    for (const image of images) {
      content.push(image);
      const id = idFromImage(image);
      if (id) existingIds.add(id);
      count++;
    }
  }

  return count === 0
    ? { count, message }
    : { count, message: { ...message, content } };
}

function transformClipboardImagePaths(
  message: any,
  nextId: number,
): { count: number; message: any } {
  if (message?.role !== "user" || !Array.isArray(message.content)) {
    return { count: 0, message };
  }

  let count = 0;
  const content: Array<TextBlock | ImageBlock | unknown> = [];

  for (const block of message.content) {
    if (!isTextBlock(block)) {
      content.push(block);
      continue;
    }

    const attachments: ImageBlock[] = [];
    const replaced = block.text.replace(
      CLIPBOARD_IMAGE_PATH_PATTERN,
      (match: string, prefix: string, path: string) => {
        const loaded = loadImageFromPath(path);
        if (!loaded) return match;

        const id = nextId + count + attachments.length;
        attachments.push({
          type: "image",
          data: loaded.data,
          mimeType: loaded.mimeType,
          piImageMeta: {
            id,
            label: `Attached [#image ${id}]`,
            hash: loaded.hash,
          },
        });
        return `${prefix}[#image ${id}]`;
      },
    );

    content.push({ ...block, text: replaced });
    for (const img of attachments) content.push(img);
    count += attachments.length;
  }

  return count === 0
    ? { count, message }
    : { count, message: { ...message, content } };
}

function inputPartsFromMessage(message: any): {
  text: string;
  images?: ImageBlock[];
} {
  const content = Array.isArray(message?.content) ? message.content : [];
  const text = content
    .filter(isTextBlock)
    .map((block: TextBlock) => block.text)
    .join("\n\n");
  const images = content.filter(isImageBlock);
  return { text, images: images.length > 0 ? images : undefined };
}

function transformStreamingInput(
  text: string,
  images: ImageBlock[] | undefined,
  nextId: number,
): {
  changed: boolean;
  submittedIds: number[];
  text: string;
  images?: ImageBlock[];
} {
  const message = {
    role: "user",
    content: [{ type: "text", text }, ...(images ?? [])],
  };

  const draftResult = transformDraftPlaceholders(message);
  const submittedResult = transformSubmittedPlaceholders(draftResult.message);
  if (draftResult.count > 0 || submittedResult.count > 0) {
    const parts = inputPartsFromMessage(submittedResult.message);
    return {
      changed: true,
      submittedIds: draftResult.submittedIds,
      ...parts,
    };
  }

  const pathResult = transformClipboardImagePaths(message, nextId);
  if (pathResult.count > 0) {
    const parts = inputPartsFromMessage(pathResult.message);
    return { changed: true, submittedIds: [], ...parts };
  }

  return { changed: false, submittedIds: [], text, images };
}

function registerInputTransform(pi: ExtensionAPI) {
  pi.on("input", (event, ctx) => {
    const nextId =
      maxSubmittedImageId(
        (ctx as any)?.sessionManager?.buildSessionContext?.().messages,
      ) + 1;
    const result = transformStreamingInput(
      event.text,
      event.images as ImageBlock[] | undefined,
      nextId,
    );
    if (!result.changed) return { action: "continue" };

    // For streaming queues, remember submitted images immediately since
    // _runAgentPrompt won't fire until delivery.
    if (event.streamingBehavior) {
      rememberSubmittedImages({
        role: "user",
        content: [
          { type: "text", text: result.text },
          ...(result.images ?? []),
        ],
      });
    }
    if (result.submittedIds.length > 0) {
      draftStore.markSubmitted(result.submittedIds);
    }

    return {
      action: "transform",
      text: result.text,
      images: result.images as any,
    };
  });
}

function patchPromptContent() {
  const prototype = AgentSession.prototype as any;
  const state = (prototype[PROMPT_PATCH_STATE] ??= {
    originalRunAgentPrompt: prototype._runAgentPrompt,
  }) as PromptPatchState;

  prototype._runAgentPrompt = function patchedRunAgentPrompt(messages: any) {
    const existingMax = maxSubmittedImageId(this?.agent?.state?.messages);
    let nextId = existingMax + 1;
    const allSubmittedIds = Array.from(pendingSubmittedDraftIds);
    pendingSubmittedDraftIds.clear();

    const transform = (message: any) => {
      // Try draft/submitted placeholder refs first (Ctrl+V and restored queues)
      const draftResult = transformDraftPlaceholders(message);
      const submittedResult = transformSubmittedPlaceholders(
        draftResult.message,
      );
      if (draftResult.count > 0 || submittedResult.count > 0) {
        allSubmittedIds.push(...draftResult.submittedIds);
        return submittedResult.message;
      }
      // Fallback: raw clipboard temp-file paths (Slice 2 compat)
      const pathResult = transformClipboardImagePaths(message, nextId);
      nextId += pathResult.count;
      return pathResult.message;
    };

    const transformed = Array.isArray(messages)
      ? messages.map(transform)
      : transform(messages);

    rememberSubmittedImages(transformed);

    const result = state.originalRunAgentPrompt.call(this, transformed);

    Promise.resolve(result).then(
      () => {
        if (allSubmittedIds.length > 0) {
          draftStore.markSubmitted(allSubmittedIds);
        }
      },
      () => {},
    );

    return result;
  };
}

function patchClipboardImagePaste() {
  const prototype = InteractiveMode.prototype as any;
  const existing = prototype[PASTE_PATCH_STATE] as
    | PastePatchState
    | boolean
    | undefined;
  const state: PastePatchState =
    existing && typeof existing === "object"
      ? existing
      : { originalHandleClipboardImagePaste: undefined };

  if (!state.originalHandleClipboardImagePaste && existing !== true) {
    state.originalHandleClipboardImagePaste =
      prototype.handleClipboardImagePaste;
  }

  prototype[PASTE_PATCH_STATE] = state;

  prototype.handleClipboardImagePaste = async function (this: any) {
    try {
      const pkgUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
      const clipUrl = new URL("./utils/clipboard-image.js", pkgUrl).href;
      const { readClipboardImage } = await import(clipUrl);

      const image = await readClipboardImage();
      if (!image) return;

      const data = Buffer.from(image.bytes).toString("base64");
      const hash = createHash("sha256").update(image.bytes).digest("hex");

      const draft = addDraftAttachment(data, image.mimeType, hash);
      this.editor.insertTextAtCursor?.(`[#image ${draft.id}]`);
      this.ui.requestRender();
    } catch {
      return state.originalHandleClipboardImagePaste?.call(this);
    }
  };
}

function patchPromptHistory() {
  const prototype = Editor.prototype as any;
  const existing = prototype[HISTORY_PATCH_STATE] as
    | HistoryPatchState
    | undefined;
  const legacy = prototype[LEGACY_EDITOR_PATCH_STATE] as any;
  const state: HistoryPatchState = existing ?? {
    originalPushUndoSnapshot:
      legacy?.originalPushUndoSnapshot ?? prototype.pushUndoSnapshot,
    originalUndo: legacy?.originalUndo ?? prototype.undo,
    originalAddToHistory:
      legacy?.originalAddToHistory ?? prototype.addToHistory,
    originalNavigateHistory:
      legacy?.originalNavigateHistory ?? prototype.navigateHistory,
    originalExitHistoryBrowsing:
      legacy?.originalExitHistoryBrowsing ?? prototype.exitHistoryBrowsing,
  };

  state.originalAddToHistory ??= prototype.addToHistory;
  state.originalNavigateHistory ??= prototype.navigateHistory;
  state.originalExitHistoryBrowsing ??= prototype.exitHistoryBrowsing;
  prototype[HISTORY_PATCH_STATE] = state;

  prototype.pushUndoSnapshot = function patchedPushUndoSnapshot() {
    const stack = editorDraftUndo.get(this) ?? [];
    stack.push(nextDraftUndoSnapshot ?? draftStore.snapshot());
    nextDraftUndoSnapshot = undefined;
    editorDraftUndo.set(this, stack);
    return state.originalPushUndoSnapshot.call(this);
  };

  prototype.undo = function patchedUndo() {
    const stack = editorDraftUndo.get(this);
    const snapshot = stack?.pop();
    state.originalUndo.call(this);
    if (snapshot) {
      draftStore.restore(snapshot);
      this.tui?.requestRender?.();
    }
  };

  prototype.addToHistory = function patchedAddToHistory(text: string) {
    const trimmed = text.trim();
    const oldTop = this.history?.[0];
    const oldLength = this.history?.length ?? 0;
    const snapshot = draftStore.snapshotForText(trimmed);

    state.originalAddToHistory.call(this, text);

    const added =
      trimmed &&
      Array.isArray(this.history) &&
      this.history[0] === trimmed &&
      (oldLength === 0 || oldTop !== trimmed);
    if (!added) return;

    const snapshots = editorHistoryDrafts.get(this) ?? [];
    snapshots.unshift(snapshot);
    snapshots.length = this.history.length;
    editorHistoryDrafts.set(this, snapshots);
  };

  prototype.navigateHistory = function patchedNavigateHistory(
    direction: number,
  ) {
    const oldIndex = this.historyIndex ?? -1;
    const newIndex = oldIndex - direction;
    const canNavigate =
      Array.isArray(this.history) &&
      this.history.length > 0 &&
      newIndex >= -1 &&
      newIndex < this.history.length;

    if (canNavigate && oldIndex === -1 && newIndex >= 0) {
      editorHistoryBrowseDraft.set(this, draftStore.snapshot());
    }

    state.originalNavigateHistory.call(this, direction);

    if (!canNavigate) return;

    if (this.historyIndex === -1) {
      const snapshot = editorHistoryBrowseDraft.get(this);
      editorHistoryBrowseDraft.delete(this);
      if (snapshot) draftStore.restore(snapshot);
      else draftStore.clearDraft();
      this.tui?.requestRender?.();
      return;
    }

    const oldText = this.getText();
    const snapshot = editorHistoryDrafts.get(this)?.[this.historyIndex];
    if (!snapshot || submittedImagesCoverSnapshotText(oldText, snapshot)) {
      draftStore.clearDraft();
      this.tui?.requestRender?.();
      return;
    }

    const result = draftStore.restoreForHistoryText(oldText, snapshot);
    if (result.textChanged) {
      const cursorOffset = direction === -1 ? 0 : oldText.length;
      setEditorTextWithoutUndo(this, result.text, cursorOffset);
    }
    this.tui?.requestRender?.();
  };

  prototype.exitHistoryBrowsing = function patchedExitHistoryBrowsing() {
    editorHistoryBrowseDraft.delete(this);
    return state.originalExitHistoryBrowsing.call(this);
  };
}

function isSingleImagePath(content: string): string | undefined {
  const trimmed = content.trim();
  if (!trimmed.startsWith("/")) return undefined;
  if (/\s/.test(trimmed)) return undefined;
  const ext = extname(trimmed).toLowerCase();
  if (!SUPPORTED_IMAGE_EXTENSIONS.has(ext)) return undefined;
  return trimmed;
}

function unsupportedSingleImagePath(
  content: string,
): { ext: string } | undefined {
  const trimmed = content.trim();
  if (!trimmed.startsWith("/")) return undefined;
  if (/\s/.test(trimmed)) return undefined;
  const ext = extname(trimmed).toLowerCase();
  return UNSUPPORTED_IMAGE_LIKE_EXTENSIONS.has(ext) ? { ext } : undefined;
}

function createDragDropHandler(
  notify?: (message: string) => void,
): (data: string) => { consume?: boolean; data?: string } | undefined {
  let pasteBuffer: string | undefined;
  let prefix = "";

  return (data: string) => {
    // Not in a paste and no paste start in this chunk → ignore
    if (pasteBuffer === undefined) {
      const startIdx = data.indexOf(PASTE_START);
      if (startIdx === -1) return undefined;

      prefix = data.slice(0, startIdx);
      pasteBuffer = data.slice(startIdx + PASTE_START.length);

      if (!pasteBuffer.includes(PASTE_END)) {
        // Paste spans multiple chunks; consume and wait
        return { consume: true };
      }
    } else {
      pasteBuffer += data;
      if (!pasteBuffer.includes(PASTE_END)) return { consume: true };
    }

    // We have the full paste content
    const endIdx = pasteBuffer.indexOf(PASTE_END);
    const content = pasteBuffer.slice(0, endIdx);
    const remaining = pasteBuffer.slice(endIdx + PASTE_END.length);
    pasteBuffer = undefined;

    const imagePath = isSingleImagePath(content);
    if (!imagePath) {
      const unsupported = unsupportedSingleImagePath(content);
      if (unsupported) {
        notify?.(
          `Image format ${unsupported.ext} is not supported; pasted path unchanged.`,
        );
      }

      // Not a single supported image path; pass through as normal bracketed paste
      const passthrough = `${prefix}${PASTE_START}${content}${PASTE_END}${remaining}`;
      prefix = "";
      return { data: passthrough };
    }

    const loaded = loadImageFromPath(imagePath);
    if (!loaded) {
      const passthrough = `${prefix}${PASTE_START}${content}${PASTE_END}${remaining}`;
      prefix = "";
      return { data: passthrough };
    }

    const draft = addDraftAttachment(loaded.data, loaded.mimeType, loaded.hash);
    const placeholder = `[#image ${draft.id}]`;

    // Return placeholder wrapped in paste brackets so editor inserts it
    const result = `${prefix}${PASTE_START}${placeholder}${PASTE_END}${remaining}`;
    prefix = "";
    return { data: result };
  };
}

function resetDraftForCurrentContext(ctx: any): void {
  const sessionCtx = ctx?.sessionManager?.buildSessionContext?.();
  rememberSubmittedImages(sessionCtx?.messages, true);
  draftStore.reset(maxSubmittedImageId(sessionCtx?.messages));
  pendingSubmittedDraftIds.clear();
  nextDraftUndoSnapshot = undefined;
}

export function installDraftAttachments(
  pi: ExtensionAPI,
): ImageAttachmentsDrafts {
  patchPromptContent();
  patchClipboardImagePaste();
  patchPromptHistory();
  registerInputTransform(pi);

  pi.on("session_start", (_event, ctx) => {
    resetDraftForCurrentContext(ctx as any);

    if (!(ctx as any).hasUI) return;
    const ui = (ctx as any).ui;

    unsubscribeDragDrop?.();
    unsubscribeDragDrop = ui.onTerminalInput(
      createDragDropHandler((message) => ui.notify?.(message, "warning")),
    );
  });

  pi.on("session_tree", (_event, ctx) => {
    resetDraftForCurrentContext(ctx as any);
  });

  pi.on("session_compact", (_event, ctx) => {
    resetDraftForCurrentContext(ctx as any);
  });

  pi.on("session_shutdown", () => {
    unsubscribeDragDrop?.();
    unsubscribeDragDrop = undefined;
  });

  return {
    activePlaceholderSpans,
    hasImageSubmitIntent,
    placeholderIdAtCursor(editor: any) {
      return placeholderIdAtCursor(editor ?? activeEditorInstance);
    },
    previewImagesForText,
    reconcileEditorDraft,
    setActiveEditor(editor: any) {
      activeEditorInstance = editor;
    },
  };
}
