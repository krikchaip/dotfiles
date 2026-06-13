import {
  AgentSession,
  InteractiveMode,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
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

class DraftStore {
  private items = new Map<number, DraftAttachment>();
  private _nextId = 1;

  reset(persistedMax: number): void {
    this.items.clear();
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

  remove(ids: number[]): void {
    for (const id of ids) this.items.delete(id);
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

function patchClipboardImagePaste() {
  const prototype = InteractiveMode.prototype as any;
  if (prototype[PASTE_PATCH_STATE]) return;
  prototype[PASTE_PATCH_STATE] = true;

  const original = prototype.handleClipboardImagePaste;

  prototype.handleClipboardImagePaste = async function (this: any) {
    try {
      const pkgUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
      const clipUrl = new URL("./utils/clipboard-image.js", pkgUrl).href;
      const { readClipboardImage } = await import(clipUrl);

      const image = await readClipboardImage();
      if (!image) return;

      const data = Buffer.from(image.bytes).toString("base64");
      const hash = createHash("sha256").update(image.bytes).digest("hex");

      const draft = draftStore.add(data, image.mimeType, hash);
      this.editor.insertTextAtCursor?.(`[#image ${draft.id}]`);
      this.ui.requestRender();
    } catch {
      return original?.call(this);
    }
  };
}

let currentDraftPreviewSignature = "";

function clearDraftPreviewWidget(ui: any): void {
  currentDraftPreviewSignature = "";
  ui?.setWidget?.(DRAFT_WIDGET_KEY, undefined, { placement: "aboveEditor" });
}

function updateDraftPreviewWidget(ui: any, text: string): void {
  if (!ui?.setWidget) return;

  const attachments = draftStore.activeForText(text);
  const signature = attachments.map((item) => item.id).join(",");
  if (signature === currentDraftPreviewSignature) return;

  currentDraftPreviewSignature = signature;
  if (attachments.length === 0) {
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

function registerInputHandler(pi: ExtensionAPI) {
  pi.on("input", (event) => {
    const result = draftImagesForText(event.text);
    if (result.images.length === 0) return { action: "continue" };

    for (const id of result.submittedIds) pendingSubmittedDraftIds.add(id);

    return {
      action: "transform",
      text: event.text,
      images: [...(event.images ?? []), ...result.images],
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
        () => draftStore.remove(allSubmittedIds),
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

    const draft = draftStore.add(loaded.data, loaded.mimeType, loaded.hash);
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

  pi.on("session_start", (_event, ctx) => {
    const sessionCtx = (ctx as any).sessionManager?.buildSessionContext?.();
    const max = maxSubmittedImageId(sessionCtx?.messages);
    draftStore.reset(max);

    if (!(ctx as any).hasUI) return;

    const ui = (ctx as any).ui;
    clearDraftPreviewWidget(ui);

    if (draftPreviewPoller) clearInterval(draftPreviewPoller);
    draftPreviewPoller = setInterval(() => {
      updateDraftPreviewWidget(ui, ui.getEditorText?.() ?? "");
    }, 250);

    unsubscribeDragDrop?.();
    unsubscribeDragDrop = ui.onTerminalInput(createDragDropHandler());
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (draftPreviewPoller) clearInterval(draftPreviewPoller);
    draftPreviewPoller = undefined;

    unsubscribeDragDrop?.();
    unsubscribeDragDrop = undefined;

    if ((ctx as any).hasUI) clearDraftPreviewWidget((ctx as any).ui);
  });
}
