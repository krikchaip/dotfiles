/**
 * Submitted image rendering.
 *
 * Replaces Pi's default user-message rendering for image-bearing user messages
 * with clean prompt text plus one framed terminal image per attachment.
 */

import {
  InteractiveMode,
  type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import {
  getCapabilities,
  getCellDimensions,
  getImageDimensions,
  Image,
  Spacer,
  truncateToWidth,
  visibleWidth,
  type Component,
  type ImageDimensions,
} from "@earendil-works/pi-tui";

const RENDER_PATCH_STATE = Symbol.for(
  "pi-image-attachments.user-message-render.patch",
);
const ATTACHED_LABEL_PATTERN = /^Attached \[#image ([1-9]\d*)\]$/;
const PLACEHOLDER_PATTERN = /^\[#image ([1-9]\d*)\]$/;
const SUBMITTED_IMAGE_FRAME_COLOR: ThemeColor = "dim";
const SUBMITTED_IMAGE_LABEL_COLOR: ThemeColor = "dim";
const SUBMITTED_IMAGE_MAX_WIDTH = 60;
const SUBMITTED_IMAGE_MAX_ROWS = 16;

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

type RenderTheme = {
  fg: (color: string, text: string) => string;
  bold?: (text: string) => string;
};

const fallbackTheme: RenderTheme = { fg: (_color, text) => text };

function imageCellWidth(
  dimensions: ImageDimensions,
  maxWidthCells: number,
  maxHeightCells: number,
): number {
  const cell = getCellDimensions();
  const widthScale = (maxWidthCells * cell.widthPx) / dimensions.widthPx;
  const heightScale = (maxHeightCells * cell.heightPx) / dimensions.heightPx;
  const scale = Math.min(widthScale, heightScale);
  return Math.max(
    1,
    Math.min(
      maxWidthCells,
      Math.ceil((dimensions.widthPx * scale) / cell.widthPx),
    ),
  );
}

async function importConvertToPng(): Promise<
  (data: string, mimeType: string) => Promise<DisplayImage | null>
> {
  const pkgUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
  const convertUrl = new URL("./utils/image-convert.js", pkgUrl).href;
  const { convertToPng } = await import(convertUrl);
  return convertToPng;
}

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

  const promptContent: TextBlock[] = [];
  const attachments: SubmittedAttachment[] = [];
  const pendingLabels: string[] = [];

  for (const block of content) {
    if (isTextBlock(block)) {
      const text = removeAttachedLabelLines(block.text, pendingLabels);
      if (text.length > 0) promptContent.push({ ...block, text });
      continue;
    }

    if (!isImageBlock(block)) continue;
    if (!block.piImageMeta && pendingLabels.length === 0) continue;

    const label = block.piImageMeta
      ? labelFromImage(block, attachments.length)
      : pendingLabels.shift()!;
    if (pendingLabels[0] === label) pendingLabels.shift();

    attachments.push({ label, image: block });
  }

  return { promptContent, attachments };
}

function themeForInteractiveMode(instance: any): RenderTheme {
  return (
    instance?.session?.extensionRunner?.getUIContext?.().theme ?? fallbackTheme
  );
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
      lines.push(...this.renderAttachmentFrame(att, i, w));
    }

    return lines;
  }

  private renderAttachmentFrame(
    att: SubmittedAttachment,
    index: number,
    width: number,
  ): string[] {
    if (width < 6) {
      return [truncateToWidth(this.submittedFrameLabel(att.label), width, "")];
    }

    const img = this.images[index];
    const maxImageWidth = Math.max(1, width - 5);
    const imageLines = img
      ? [...img.render(maxImageWidth + 2)]
      : [
          truncateToWidth(
            this.theme.fg(
              "muted",
              this.convertingImages.has(index)
                ? "(converting image...)"
                : "(image unavailable)",
            ),
            maxImageWidth,
            "",
          ),
        ];

    const imageWidth = this.submittedImageWidth(
      att,
      index,
      maxImageWidth,
      imageLines,
    );
    const titleWidth = visibleWidth(att.label);
    const desiredWidth = Math.max(imageWidth, titleWidth) + 5;
    const frameWidth = Math.max(6, Math.min(width, desiredWidth));
    const contentWidth = frameWidth - 5;

    return [
      this.submittedFrameTopLine(att.label, contentWidth),
      ...imageLines.map((line) =>
        this.submittedFrameBodyLine(line, contentWidth),
      ),
      this.submittedFrameBottomLine(frameWidth),
    ];
  }

  private submittedImageWidth(
    att: SubmittedAttachment,
    index: number,
    maxImageWidth: number,
    imageLines: string[],
  ): number {
    const textWidth = Math.max(
      0,
      ...imageLines.map((line) => visibleWidth(line)),
    );
    if (textWidth > 0) return textWidth;

    const display = this.displayImage(att, index);
    if (!display || !getCapabilities().images) return 1;

    const dimensions = getImageDimensions(display.data, display.mimeType);
    if (!dimensions) return 1;

    return imageCellWidth(
      dimensions,
      Math.min(maxImageWidth, SUBMITTED_IMAGE_MAX_WIDTH),
      SUBMITTED_IMAGE_MAX_ROWS,
    );
  }

  private displayImage(
    att: SubmittedAttachment,
    index: number,
  ): DisplayImage | undefined {
    if (!att.image.data || !att.image.mimeType) return undefined;
    return (
      this.convertedImages.get(index) ?? {
        data: att.image.data,
        mimeType: att.image.mimeType,
      }
    );
  }

  private submittedFrameBorder(text: string): string {
    return this.theme.fg(SUBMITTED_IMAGE_FRAME_COLOR, text);
  }

  private submittedFrameLabel(text: string): string {
    return this.theme.fg(SUBMITTED_IMAGE_LABEL_COLOR, text);
  }

  private submittedFrameTopLine(label: string, contentWidth: number): string {
    const cell = truncateToWidth(label, contentWidth, "");
    const fill = "─".repeat(Math.max(0, contentWidth - visibleWidth(cell)));
    return `${this.submittedFrameBorder("╭─ ")}${this.submittedFrameLabel(
      cell,
    )}${this.submittedFrameBorder(` ${fill}╮`)}`;
  }

  private submittedFrameBodyLine(text: string, contentWidth: number): string {
    const cell = truncateToWidth(text, contentWidth, "");
    const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(cell)));
    return `${this.submittedFrameBorder("│  ")}${cell}${padding}${this.submittedFrameBorder(
      " │",
    )}`;
  }

  private submittedFrameBottomLine(frameWidth: number): string {
    return this.submittedFrameBorder(
      `╰${"─".repeat(Math.max(0, frameWidth - 2))}╯`,
    );
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

    const display = this.displayImage(att, index)!;

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
      {
        maxWidthCells: SUBMITTED_IMAGE_MAX_WIDTH,
        maxHeightCells: SUBMITTED_IMAGE_MAX_ROWS,
        filename: att.label,
      },
    );
  }
}

export function installSubmittedRendering() {
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
      const textBlockCount = message.content.filter(isTextBlock).length;
      const displayMessage =
        promptContent.length === textBlockCount
          ? message
          : { ...message, content: promptContent };
      return state.originalAddMessageToChat.call(this, displayMessage, options);
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
