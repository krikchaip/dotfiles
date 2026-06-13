import {
  AgentSession,
  InteractiveMode,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
  Editor,
  getCapabilities,
  Image,
  Spacer,
  truncateToWidth,
  type Component,
} from "@earendil-works/pi-tui";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const RENDER_PATCH_STATE = Symbol.for(
  "pi-image-attachments.user-message-render.patch",
);
const PROMPT_PATCH_STATE = Symbol.for(
  "pi-image-attachments.prompt-content.patch",
);
const PASTE_PATCH_STATE = Symbol.for("pi-image-attachments.paste.patch");
const EDITOR_PATCH_STATE = Symbol.for("pi-image-attachments.editor.patch");
const DRAFT_WIDGET_KEY = "pi-image-attachments-draft-preview";
const ATTACHED_LABEL_PATTERN = /^Attached \[#image ([1-9]\d*)\]$/;
const PLACEHOLDER_PATTERN = /^\[#image ([1-9]\d*)\]$/;
const INLINE_PLACEHOLDER_PATTERN = /\[#image ([1-9]\d*)\]/g;
const CLIPBOARD_IMAGE_PATH_PATTERN =
  /(^|[\s"'`([{<])((?:\/[^\s"'`()\[\]{}<>]+)*\/pi-clipboard-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(?:png|jpe?g|gif|webp))(?=$|[\s"'`)\]}>,.!?;:])/g;

// ---------------------------------------------------------------------------
// Draft Store — holds clipboard images between paste and submit
// ---------------------------------------------------------------------------

type DraftAttachment = {
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

  restore(snapshot: DraftStoreSnapshot): void {
    this.items = new Map(snapshot.items.map((item) => [item.id, { ...item }]));
    this._nextId = snapshot.nextId;
    this.persistedMax = snapshot.persistedMax;
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
const pendingSubmittedDraftIds = new Set<number>();
let nextDraftUndoSnapshot: DraftStoreSnapshot | undefined;
let draftPreviewPoller: ReturnType<typeof setInterval> | undefined;
let unsubscribeDragDrop: (() => void) | undefined;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TextBlock = { type: "text"; text: string };

type ImageBlock = {
  type: "image";
  data?: string;
  mimeType?: string;
  piImageMeta?: { id?: number; label?: string; hash?: string };
};

type SubmittedAttachment = { label: string; image: ImageBlock };

type DisplayImage = { data: string; mimeType: string };

type RenderPatchState = {
  originalAddMessageToChat: (message: any, options?: any) => void;
};

type PromptPatchState = {
  originalRunAgentPrompt: (messages: any) => Promise<void>;
};

type PastePatchState = {
  originalHandleClipboardImagePaste?: () => Promise<void>;
};

type RenderTheme = { fg: (color: string, text: string) => string };

const fallbackTheme: RenderTheme = { fg: (_color, text) => text };

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

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

function splitUserContent(content: unknown): {
  promptContent: TextBlock[];
  attachments: SubmittedAttachment[];
} {
  if (!Array.isArray(content)) return { promptContent: [], attachments: [] };

  const usedLabelIndexes = new Set<number>();
  const attachments: SubmittedAttachment[] = [];

  for (let index = 0; index < content.length; index++) {
    const block = content[index];
    // Only handle images marked by our plugin (piImageMeta present)
    if (!isImageBlock(block) || !block.piImageMeta) continue;

    const previous = content[index - 1];
    const label =
      isTextBlock(previous) && ATTACHED_LABEL_PATTERN.test(previous.text)
        ? previous.text
        : labelFromImage(block, attachments.length);

    if (isTextBlock(previous) && label === previous.text) {
      usedLabelIndexes.add(index - 1);
    }

    attachments.push({ label, image: block });
  }

  const promptContent = content.filter(
    (block, index): block is TextBlock =>
      isTextBlock(block) && !usedLabelIndexes.has(index),
  );

  return { promptContent, attachments };
}

function themeForInteractiveMode(instance: any): RenderTheme {
  return (
    instance?.session?.extensionRunner?.getUIContext?.().theme ?? fallbackTheme
  );
}

function idFromImage(block: ImageBlock): number | undefined {
  const id = block.piImageMeta?.id;
  return typeof id === "number" && Number.isInteger(id) && id > 0
    ? id
    : undefined;
}

function maxSubmittedImageId(messages: unknown): number {
  const list = Array.isArray(messages) ? messages : [messages];
  let max = 0;

  for (const message of list) {
    const content = (message as any)?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (!isImageBlock(block)) continue;
      const id = idFromImage(block);
      if (id) max = Math.max(max, id);
    }
  }

  return max;
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

// ---------------------------------------------------------------------------
// Rendering: draft/submitted images
// ---------------------------------------------------------------------------

async function importConvertToPng(): Promise<
  (data: string, mimeType: string) => Promise<DisplayImage | null>
> {
  const pkgUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
  const convertUrl = new URL("./utils/image-convert.js", pkgUrl).href;
  const { convertToPng } = await import(convertUrl);
  return convertToPng;
}

class DraftPreviewComponent implements Component {
  private readonly convertedImages = new Map<number, DisplayImage>();
  private readonly convertingImages = new Set<number>();
  private images: Array<Image | undefined>;

  constructor(
    private readonly attachments: DraftAttachment[],
    private readonly theme: RenderTheme,
    private readonly requestRender: () => void,
  ) {
    this.images = attachments.map((a, i) => this.createImage(a, i));
    this.maybeConvertImagesForKitty();
  }

  invalidate(): void {
    for (const img of this.images) img?.invalidate();
  }

  render(width: number): string[] {
    const w = Math.max(1, width);
    const count = this.attachments.length;
    const header =
      count === 1 ? " 📎 1 image attached" : ` 📎 ${count} images attached`;
    const lines = [truncateToWidth(this.theme.fg("accent", header), w, "")];

    for (let i = 0; i < this.attachments.length; i++) {
      const att = this.attachments[i]!;
      const img = this.images[i];
      if (img) {
        lines.push(...img.render(w));
      } else {
        const message = this.convertingImages.has(i)
          ? "(converting image...)"
          : "(image unavailable)";
        lines.push(truncateToWidth(this.theme.fg("muted", message), w, ""));
      }
      lines.push(
        truncateToWidth(this.theme.fg("muted", `[#image ${att.id}]`), w, ""),
      );
    }

    return lines;
  }

  private maybeConvertImagesForKitty(): void {
    if (getCapabilities().images !== "kitty") return;

    for (let i = 0; i < this.attachments.length; i++) {
      const img = this.attachments[i]!;
      if (img.mimeType === "image/png") continue;
      if (this.convertedImages.has(i) || this.convertingImages.has(i)) continue;

      this.convertingImages.add(i);
      importConvertToPng()
        .then((convertToPng) => convertToPng(img.data, img.mimeType))
        .then((converted) => {
          if (!converted) return;
          this.convertedImages.set(i, converted);
          this.images[i] = this.createImage(this.attachments[i]!, i);
          this.requestRender();
        })
        .finally(() => {
          this.convertingImages.delete(i);
        });
    }
  }

  private createImage(att: DraftAttachment, index: number): Image | undefined {
    const display = this.convertedImages.get(index) ?? {
      data: att.data,
      mimeType: att.mimeType,
    };

    if (
      getCapabilities().images === "kitty" &&
      display.mimeType !== "image/png"
    ) {
      return undefined;
    }

    return new Image(
      display.data,
      display.mimeType,
      { fallbackColor: (text: string) => this.theme.fg("muted", text) },
      { maxWidthCells: 60, maxHeightCells: 16, filename: `[#image ${att.id}]` },
    );
  }
}

// TODO(polish): avoid slow cold-start rendering for old submitted images.
// Consider compact historical labels, lazy preview expansion, or a preview cache.
class SubmittedImagesComponent implements Component {
  private readonly convertedImages = new Map<number, DisplayImage>();
  private readonly convertingImages = new Set<number>();
  private images: Array<Image | undefined>;

  constructor(
    private readonly attachments: SubmittedAttachment[],
    private readonly theme: RenderTheme,
    private readonly requestRender: () => void,
  ) {
    this.images = attachments.map((a, i) => this.createImage(a, i));
    this.maybeConvertImagesForKitty();
  }

  invalidate(): void {
    for (const img of this.images) img?.invalidate();
  }

  render(width: number): string[] {
    const w = Math.max(1, width);
    const lines: string[] = [];

    for (let i = 0; i < this.attachments.length; i++) {
      const att = this.attachments[i]!;
      lines.push("");
      lines.push(truncateToWidth(this.theme.fg("muted", att.label), w, ""));

      const img = this.images[i];
      if (img) {
        lines.push(...img.render(w));
      } else {
        const message = this.convertingImages.has(i)
          ? "(converting image...)"
          : "(image unavailable)";
        lines.push(truncateToWidth(this.theme.fg("muted", message), w, ""));
      }
    }

    return lines;
  }

  private maybeConvertImagesForKitty(): void {
    if (getCapabilities().images !== "kitty") return;

    for (let i = 0; i < this.attachments.length; i++) {
      const img = this.attachments[i]!.image;
      if (!img.data || !img.mimeType || img.mimeType === "image/png") continue;
      if (this.convertedImages.has(i) || this.convertingImages.has(i)) continue;

      this.convertingImages.add(i);
      importConvertToPng()
        .then((convertToPng) => convertToPng(img.data!, img.mimeType!))
        .then((converted) => {
          if (!converted) return;
          this.convertedImages.set(i, converted);
          this.images[i] = this.createImage(this.attachments[i]!, i);
          this.requestRender();
        })
        .finally(() => {
          this.convertingImages.delete(i);
        });
    }
  }

  private createImage(
    att: SubmittedAttachment,
    index: number,
  ): Image | undefined {
    if (!att.image.data || !att.image.mimeType) return undefined;

    const display = this.convertedImages.get(index) ?? {
      data: att.image.data,
      mimeType: att.image.mimeType,
    };

    if (
      getCapabilities().images === "kitty" &&
      display.mimeType !== "image/png"
    ) {
      return undefined;
    }

    return new Image(
      display.data,
      display.mimeType,
      { fallbackColor: (text: string) => this.theme.fg("muted", text) },
      { maxWidthCells: 60, maxHeightCells: 16, filename: att.label },
    );
  }
}

// ---------------------------------------------------------------------------
// Patch: render user messages with our images
// ---------------------------------------------------------------------------

function patchUserMessageRendering() {
  const prototype = InteractiveMode.prototype as any;
  const state = (prototype[RENDER_PATCH_STATE] ??= {
    originalAddMessageToChat: prototype.addMessageToChat,
  }) as RenderPatchState;

  prototype.addMessageToChat = function patchedAddMessageToChat(
    message: any,
    options?: any,
  ) {
    if (message?.role !== "user" || !Array.isArray(message.content)) {
      return state.originalAddMessageToChat.call(this, message, options);
    }

    const { promptContent, attachments } = splitUserContent(message.content);
    if (attachments.length === 0) {
      return state.originalAddMessageToChat.call(this, message, options);
    }

    state.originalAddMessageToChat.call(
      this,
      { ...message, content: promptContent },
      options,
    );

    if (
      promptContent.length === 0 &&
      this.chatContainer?.children?.length > 0
    ) {
      this.chatContainer.addChild(new Spacer(1));
    }

    this.chatContainer?.addChild(
      new SubmittedImagesComponent(
        attachments,
        themeForInteractiveMode(this),
        () => this.ui.requestRender(),
      ),
    );
  };
}

// ---------------------------------------------------------------------------
// Patch: Ctrl+V — store image in draft, insert placeholder
// ---------------------------------------------------------------------------

function addDraftAttachment(
  data: string,
  mimeType: string,
  hash: string,
): DraftAttachment {
  nextDraftUndoSnapshot = draftStore.snapshot();
  return draftStore.add(data, mimeType, hash);
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

let currentDraftPreviewSignature = "";

function clearDraftPreviewWidget(ui: any): void {
  currentDraftPreviewSignature = "";
  ui?.setWidget?.(DRAFT_WIDGET_KEY, undefined, { placement: "aboveEditor" });
}

function resetDraftForCurrentContext(ctx: any): void {
  const sessionCtx = ctx?.sessionManager?.buildSessionContext?.();
  draftStore.reset(maxSubmittedImageId(sessionCtx?.messages));
  pendingSubmittedDraftIds.clear();
  nextDraftUndoSnapshot = undefined;
  if (ctx?.hasUI) clearDraftPreviewWidget(ctx.ui);
}

function updateDraftPreviewWidget(ui: any, text: string): void {
  if (!ui?.setWidget) return;

  const attachments = draftStore.activeForText(text);
  const signature = attachments
    .map((item) => `${item.id}:${item.hash}`)
    .join(",");
  if (signature === currentDraftPreviewSignature) return;

  currentDraftPreviewSignature = signature;
  if (attachments.length === 0) {
    draftStore.clearDraft();
    ui.setWidget(DRAFT_WIDGET_KEY, undefined, { placement: "aboveEditor" });
    ui.requestRender?.();
    return;
  }

  ui.setWidget(
    DRAFT_WIDGET_KEY,
    (_tui: unknown, theme: RenderTheme) =>
      new DraftPreviewComponent(attachments, theme, () => ui.requestRender?.()),
    { placement: "aboveEditor" },
  );
  ui.requestRender?.();
}

// ---------------------------------------------------------------------------
// Patch: editor — atomic active placeholders and draft renumbering
// ---------------------------------------------------------------------------

type EditorPatchState = {
  originalSegment: (text: string, mode: "word" | "grapheme") => Iterable<any>;
  originalRender: (width: number) => string[];
  originalHandleBackspace: () => void;
  originalHandleForwardDelete: () => void;
  originalDeleteWordBackwards: () => void;
  originalDeleteWordForward: () => void;
  originalDeleteToStartOfLine: () => void;
  originalDeleteToEndOfLine: () => void;
  originalPushUndoSnapshot: () => void;
  originalUndo: () => void;
};

const editorDraftUndo = new WeakMap<object, DraftStoreSnapshot[]>();

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
    if (!draftStore.has(id)) continue;
    spans.push({ id, start: m.index, end: m.index + m[0].length });
  }

  return spans;
}

function segmentWithActivePlaceholders(
  text: string,
  baseSegments: Iterable<any>,
): any[] {
  if (!text.includes("[#image ")) return [...baseSegments];

  const spans = activePlaceholderSpans(text);
  if (spans.length === 0) return [...baseSegments];

  const result: any[] = [];
  let spanIndex = 0;

  for (const seg of baseSegments) {
    while (spanIndex < spans.length && spans[spanIndex]!.end <= seg.index) {
      spanIndex++;
    }

    const span = spans[spanIndex];
    if (span && seg.index >= span.start && seg.index < span.end) {
      if (seg.index === span.start) {
        result.push({
          segment: text.slice(span.start, span.end),
          index: span.start,
          input: text,
        });
      }
      continue;
    }

    result.push(seg);
  }

  return result;
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

function activePlaceholderIdAtCursor(editor: any): number | undefined {
  const line = editor?.state?.lines?.[editor?.state?.cursorLine ?? 0] ?? "";
  const col = editor?.state?.cursorCol ?? 0;

  for (const span of activePlaceholderSpans(line)) {
    if (col >= span.start && col < span.end) return span.id;
  }

  return undefined;
}

function highlightPlainToken(line: string, token: string): string {
  let output = "";
  let cursor = 0;

  while (true) {
    const index = line.indexOf(token, cursor);
    if (index === -1) return output + line.slice(cursor);

    output += line.slice(cursor, index);
    const alreadyHighlighted =
      line.slice(Math.max(0, index - 4), index) === "\x1b[7m";
    output += alreadyHighlighted ? token : `\x1b[7m${token}\x1b[0m`;
    cursor = index + token.length;
  }
}

function patchEditorAtomicPlaceholders() {
  const prototype = Editor.prototype as any;
  const existing = prototype[EDITOR_PATCH_STATE] as
    | EditorPatchState
    | undefined;
  const state: EditorPatchState = existing ?? {
    originalSegment: prototype.segment,
    originalRender: prototype.render,
    originalHandleBackspace: prototype.handleBackspace,
    originalHandleForwardDelete: prototype.handleForwardDelete,
    originalDeleteWordBackwards: prototype.deleteWordBackwards,
    originalDeleteWordForward: prototype.deleteWordForward,
    originalDeleteToStartOfLine: prototype.deleteToStartOfLine,
    originalDeleteToEndOfLine: prototype.deleteToEndOfLine,
    originalPushUndoSnapshot: prototype.pushUndoSnapshot,
    originalUndo: prototype.undo,
  };

  prototype[EDITOR_PATCH_STATE] = state;

  prototype.segment = function patchedSegment(
    text: string,
    mode: "word" | "grapheme",
  ) {
    const base = state.originalSegment.call(this, text, mode);
    return segmentWithActivePlaceholders(text, base);
  };

  prototype.render = function patchedRender(width: number) {
    const lines = state.originalRender.call(this, width);
    const activeId = activePlaceholderIdAtCursor(this);
    if (!activeId) return lines;

    return lines.map((line) =>
      highlightPlainToken(line, `[#image ${activeId}]`),
    );
  };

  prototype.handleBackspace = function patchedHandleBackspace() {
    state.originalHandleBackspace.call(this);
    reconcileEditorDraft(this);
  };

  prototype.handleForwardDelete = function patchedHandleForwardDelete() {
    state.originalHandleForwardDelete.call(this);
    reconcileEditorDraft(this);
  };

  prototype.deleteWordBackwards = function patchedDeleteWordBackwards() {
    state.originalDeleteWordBackwards.call(this);
    reconcileEditorDraft(this);
  };

  prototype.deleteWordForward = function patchedDeleteWordForward() {
    state.originalDeleteWordForward.call(this);
    reconcileEditorDraft(this);
  };

  prototype.deleteToStartOfLine = function patchedDeleteToStartOfLine() {
    state.originalDeleteToStartOfLine.call(this);
    reconcileEditorDraft(this);
  };

  prototype.deleteToEndOfLine = function patchedDeleteToEndOfLine() {
    state.originalDeleteToEndOfLine.call(this);
    reconcileEditorDraft(this);
  };

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
}

// ---------------------------------------------------------------------------
// Patch: submit — resolve draft placeholders, fallback to path loading
// ---------------------------------------------------------------------------

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
    for (const image of images) {
      const id = idFromImage(image);
      if (id) content.push({ type: "text", text: `Attached [#image ${id}]` });
      content.push(image);
    }

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
    for (const img of attachments) {
      const id = idFromImage(img);
      if (id) content.push({ type: "text", text: `Attached [#image ${id}]` });
      content.push(img);
    }
    count += attachments.length;
  }

  return count === 0
    ? { count, message }
    : { count, message: { ...message, content } };
}

function registerInputHandler(_pi: ExtensionAPI) {
  // Submit image blocks are inserted by the _runAgentPrompt patch so label/image
  // blocks can stay adjacent in the final provider payload.
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
      // Try draft store first (Ctrl+V path)
      const draftResult = transformDraftPlaceholders(message);
      if (draftResult.count > 0) {
        allSubmittedIds.push(...draftResult.submittedIds);
        return draftResult.message;
      }
      // Fallback: raw clipboard temp-file paths (Slice 2 compat)
      const pathResult = transformClipboardImagePaths(message, nextId);
      nextId += pathResult.count;
      return pathResult.message;
    };

    const transformed = Array.isArray(messages)
      ? messages.map(transform)
      : transform(messages);

    const result = state.originalRunAgentPrompt.call(this, transformed);

    if (allSubmittedIds.length > 0) {
      Promise.resolve(result).then(
        () => draftStore.markSubmitted(allSubmittedIds),
        () => {},
      );
    }

    return result;
  };
}

// ---------------------------------------------------------------------------
// Drag-and-drop: intercept bracketed paste of a single image path
// ---------------------------------------------------------------------------

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
]);

function isSingleImagePath(content: string): string | undefined {
  const trimmed = content.trim();
  if (!trimmed.startsWith("/")) return undefined;
  if (/\s/.test(trimmed)) return undefined;
  const ext = extname(trimmed).toLowerCase();
  if (!SUPPORTED_IMAGE_EXTENSIONS.has(ext)) return undefined;
  return trimmed;
}

function createDragDropHandler(): (
  data: string,
) => { consume?: boolean; data?: string } | undefined {
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
      // Not a single image path; pass through as normal bracketed paste
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

// ---------------------------------------------------------------------------
// Extension entry
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  registerInputHandler(pi);
  patchPromptContent();
  patchUserMessageRendering();
  patchClipboardImagePaste();
  patchEditorAtomicPlaceholders();

  pi.on("session_start", (_event, ctx) => {
    resetDraftForCurrentContext(ctx as any);

    if (!(ctx as any).hasUI) return;

    const ui = (ctx as any).ui;

    if (draftPreviewPoller) clearInterval(draftPreviewPoller);
    draftPreviewPoller = setInterval(() => {
      updateDraftPreviewWidget(ui, ui.getEditorText?.() ?? "");
    }, 250);

    unsubscribeDragDrop?.();
    unsubscribeDragDrop = ui.onTerminalInput(createDragDropHandler());
  });

  pi.on("session_tree", (_event, ctx) => {
    resetDraftForCurrentContext(ctx as any);
  });

  pi.on("session_compact", (_event, ctx) => {
    resetDraftForCurrentContext(ctx as any);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (draftPreviewPoller) clearInterval(draftPreviewPoller);
    draftPreviewPoller = undefined;

    unsubscribeDragDrop?.();
    unsubscribeDragDrop = undefined;

    if ((ctx as any).hasUI) clearDraftPreviewWidget((ctx as any).ui);
  });
}
