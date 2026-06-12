import {
  InteractiveMode,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
  Image,
  Spacer,
  truncateToWidth,
  type Component,
} from "@earendil-works/pi-tui";

const PATCH_STATE = Symbol.for(
  "pi-image-attachments.user-message-render.patch",
);
const ATTACHED_LABEL_PATTERN = /^Attached \[#image ([1-9]\d*)\]$/;
const PLACEHOLDER_PATTERN = /^\[#image ([1-9]\d*)\]$/;

type TextBlock = {
  type: "text";
  text: string;
};

type ImageBlock = {
  type: "image";
  data?: string;
  mimeType?: string;
  piImageMeta?: {
    id?: number;
    label?: string;
  };
};

type SubmittedAttachment = {
  label: string;
  image: ImageBlock;
};

type PatchState = {
  originalAddMessageToChat: (message: any, options?: any) => void;
};

type RenderTheme = {
  fg: (color: string, text: string) => string;
};

const fallbackTheme: RenderTheme = {
  fg: (_color, text) => text,
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

function splitUserContent(content: unknown): {
  promptContent: TextBlock[];
  attachments: SubmittedAttachment[];
} {
  if (!Array.isArray(content)) return { promptContent: [], attachments: [] };

  const usedLabelIndexes = new Set<number>();
  const attachments: SubmittedAttachment[] = [];

  for (let index = 0; index < content.length; index++) {
    const block = content[index];
    if (!isImageBlock(block)) continue;

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

class SubmittedImagesComponent implements Component {
  private readonly images: Array<Image | undefined>;

  constructor(
    private readonly attachments: SubmittedAttachment[],
    private readonly theme: RenderTheme,
  ) {
    this.images = attachments.map((attachment) => this.createImage(attachment));
  }

  invalidate(): void {
    for (const image of this.images) image?.invalidate();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const lines: string[] = [];

    for (let index = 0; index < this.attachments.length; index++) {
      const attachment = this.attachments[index]!;
      lines.push(
        truncateToWidth(
          this.theme.fg("muted", attachment.label),
          safeWidth,
          "",
        ),
      );

      const image = this.images[index];
      if (image) {
        lines.push(...image.render(safeWidth));
      } else {
        lines.push(
          truncateToWidth(
            this.theme.fg("muted", "(image unavailable)"),
            safeWidth,
            "",
          ),
        );
      }
    }

    return lines;
  }

  private createImage(attachment: SubmittedAttachment): Image | undefined {
    if (!attachment.image.data || !attachment.image.mimeType) return undefined;

    return new Image(
      attachment.image.data,
      attachment.image.mimeType,
      { fallbackColor: (text: string) => this.theme.fg("muted", text) },
      {
        maxWidthCells: 60,
        maxHeightCells: 16,
        filename: attachment.label,
      },
    );
  }
}

function themeForInteractiveMode(instance: any): RenderTheme {
  return (
    instance?.session?.extensionRunner?.getUIContext?.().theme ?? fallbackTheme
  );
}

function patchUserMessageRendering() {
  const prototype = InteractiveMode.prototype as any;
  const state = (prototype[PATCH_STATE] ??= {
    originalAddMessageToChat: prototype.addMessageToChat,
  }) as PatchState;

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
      new SubmittedImagesComponent(attachments, themeForInteractiveMode(this)),
    );
  };
}

export default function (_pi: ExtensionAPI) {
  patchUserMessageRendering();
}
