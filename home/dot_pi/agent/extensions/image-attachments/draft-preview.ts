/**
 * Draft image preview widget.
 *
 * Adds an above-editor gallery showing currently referenced draft/submitted
 * images and highlights the image placeholder under the editor cursor.
 */

import {
  type ExtensionAPI,
  type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import {
  getCapabilities,
  Image,
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";
import type {
  DraftAttachment,
  ImageAttachmentsDrafts,
} from "./draft-attachments";

const DRAFT_WIDGET_KEY = "pi-image-attachments-draft-preview";
const DRAFT_THUMB_MAX_WIDTH = 25;
const DRAFT_THUMB_MAX_ROWS = 10;
const DRAFT_THUMB_GAP = 1;
const DRAFT_PREVIEW_POLL_MS = 250;
const DRAFT_PREVIEW_FRAME_COLOR: ThemeColor = "dim";
const DRAFT_PREVIEW_LABEL_COLOR: ThemeColor = "dim";
const DRAFT_PREVIEW_ACTIVE_HIGHLIGHT_MODE: DraftPreviewActiveHighlightMode =
  "label";

type DraftPreviewActiveHighlightMode = "frame" | "label";
type DisplayImage = { data: string; mimeType: string };

type RenderTheme = {
  fg: (color: string, text: string) => string;
  bold?: (text: string) => string;
};

let draftPreviewPoller: ReturnType<typeof setInterval> | undefined;
let currentDraftPreviewSignature = "";

function boldText(theme: RenderTheme, text: string): string {
  return theme.bold ? theme.bold(text) : `\x1b[1m${text}\x1b[22m`;
}

function previewLabelStyle(
  theme: RenderTheme,
  text: string,
  active: boolean,
): string {
  return theme.fg(
    DRAFT_PREVIEW_LABEL_COLOR,
    active ? boldText(theme, text) : text,
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

class DraftPreviewComponent implements Component {
  private readonly convertedImages = new Map<number, DisplayImage>();
  private readonly convertingImages = new Set<number>();
  private images: Array<Image | undefined>;

  constructor(
    private readonly attachments: DraftAttachment[],
    private readonly getActiveId: () => number | undefined,
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

    const gap = DRAFT_THUMB_GAP;
    const maxFrameWidth = DRAFT_THUMB_MAX_WIDTH + 2;
    const columnCount = Math.max(
      1,
      Math.min(count, Math.floor((w + gap) / (maxFrameWidth + gap)) || 1),
    );
    const itemWidth = Math.max(
      3,
      Math.min(
        maxFrameWidth,
        Math.floor((w - gap * (columnCount - 1)) / columnCount),
      ),
    );

    for (let start = 0; start < this.attachments.length; start += columnCount) {
      const items = this.attachments
        .slice(start, start + columnCount)
        .map((att, offset) => this.renderItem(start + offset, att, itemWidth));
      const height = Math.max(...items.map((item) => item.length));

      for (let row = 0; row < height; row++) {
        const line = items
          .map((item) => this.padCell(item[row] ?? "", itemWidth))
          .join(" ".repeat(gap));
        lines.push(truncateToWidth(line, w, ""));
      }
    }

    return lines;
  }

  private renderItem(
    index: number,
    att: DraftAttachment,
    frameWidth: number,
  ): string[] {
    const innerWidth = Math.max(1, frameWidth - 2);
    const img = this.images[index];
    const imageLines = img
      ? [...img.render(innerWidth + 2)]
      : [
          truncateToWidth(
            this.theme.fg(
              "muted",
              this.convertingImages.has(index)
                ? "(converting image...)"
                : "(image unavailable)",
            ),
            innerWidth,
            "",
          ),
        ];

    const active = att.id === this.getActiveId();
    const frameActive =
      active && DRAFT_PREVIEW_ACTIVE_HIGHLIGHT_MODE === "frame";
    const labelActive = active;
    const topPadding = Math.max(
      0,
      Math.floor((DRAFT_THUMB_MAX_ROWS - imageLines.length) / 2),
    );
    const bodyLines: string[] = [];
    for (let row = 0; row < DRAFT_THUMB_MAX_ROWS; row++) {
      const imageLine = imageLines[row - topPadding] ?? "";
      bodyLines.push(this.frameBodyLine(imageLine, innerWidth, frameActive));
    }

    return [
      this.frameTopLine(innerWidth, frameActive),
      ...bodyLines,
      this.frameLabelLine(
        previewLabelStyle(this.theme, `[#image ${att.id}]`, labelActive),
        innerWidth,
        frameActive,
      ),
    ];
  }

  private frameBorder(text: string, active: boolean): string {
    return this.theme.fg(
      DRAFT_PREVIEW_FRAME_COLOR,
      active ? boldText(this.theme, text) : text,
    );
  }

  private frameTopLine(innerWidth: number, active: boolean): string {
    const chars = active
      ? { left: "┏", horizontal: "━", right: "┓" }
      : { left: "┌", horizontal: "─", right: "┐" };
    return this.frameBorder(
      `${chars.left}${chars.horizontal.repeat(innerWidth)}${chars.right}`,
      active,
    );
  }

  private frameBodyLine(
    text: string,
    innerWidth: number,
    active: boolean,
  ): string {
    const vertical = active ? "┃" : "│";
    return `${this.frameBorder(vertical, active)}${this.centerCell(
      text,
      innerWidth,
    )}${this.frameBorder(vertical, active)}`;
  }

  private frameLabelLine(
    label: string,
    innerWidth: number,
    active: boolean,
  ): string {
    const cell =
      visibleWidth(label) > innerWidth
        ? truncateToWidth(label, innerWidth, "")
        : label;
    const padding = Math.max(0, innerWidth - visibleWidth(cell));
    const left = Math.floor(padding / 2);
    const right = padding - left;

    const chars = active
      ? { left: "┗", horizontal: "━", right: "┛" }
      : { left: "└", horizontal: "─", right: "┘" };
    return `${this.frameBorder(
      `${chars.left}${chars.horizontal.repeat(left)}`,
      active,
    )}${cell}${this.frameBorder(
      `${chars.horizontal.repeat(right)}${chars.right}`,
      active,
    )}`;
  }

  private centerCell(text: string, width: number, fill = " "): string {
    const visible = visibleWidth(text);
    const cell = visible > width ? truncateToWidth(text, width, "") : text;
    const padding = Math.max(0, width - visibleWidth(cell));
    const left = Math.floor(padding / 2);
    const right = padding - left;
    return `${fill.repeat(left)}${cell}${fill.repeat(right)}`;
  }

  private padCell(text: string, width: number): string {
    return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
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
      {
        maxWidthCells: DRAFT_THUMB_MAX_WIDTH,
        maxHeightCells: DRAFT_THUMB_MAX_ROWS,
        filename: `[#image ${att.id}]`,
      },
    );
  }
}

function clearDraftPreviewWidget(ui: any): void {
  currentDraftPreviewSignature = "";
  ui?.setWidget?.(DRAFT_WIDGET_KEY, undefined, { placement: "aboveEditor" });
}

function updateDraftPreviewWidget(
  drafts: ImageAttachmentsDrafts,
  ui: any,
  text: string,
): void {
  if (!ui?.setWidget) return;

  const attachments = drafts.previewImagesForText(text);
  const signature = attachments
    .map((item) => `${item.id}:${item.mimeType}:${item.hash}`)
    .join(",");
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
      new DraftPreviewComponent(
        attachments,
        () => drafts.placeholderIdAtCursor(undefined),
        theme,
        () => ui.requestRender?.(),
      ),
    { placement: "aboveEditor" },
  );
  ui.requestRender?.();
}

export function installDraftPreview(
  pi: ExtensionAPI,
  drafts: ImageAttachmentsDrafts,
) {
  pi.on("session_start", (_event, ctx) => {
    if (!(ctx as any).hasUI) return;
    const ui = (ctx as any).ui;

    clearDraftPreviewWidget(ui);

    if (draftPreviewPoller) clearInterval(draftPreviewPoller);
    draftPreviewPoller = setInterval(() => {
      updateDraftPreviewWidget(drafts, ui, ui.getEditorText?.() ?? "");
    }, DRAFT_PREVIEW_POLL_MS);
  });

  pi.on("session_tree", (_event, ctx) => {
    if ((ctx as any).hasUI) clearDraftPreviewWidget((ctx as any).ui);
  });

  pi.on("session_compact", (_event, ctx) => {
    if ((ctx as any).hasUI) clearDraftPreviewWidget((ctx as any).ui);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (draftPreviewPoller) clearInterval(draftPreviewPoller);
    draftPreviewPoller = undefined;

    if ((ctx as any).hasUI) clearDraftPreviewWidget((ctx as any).ui);
  });
}
