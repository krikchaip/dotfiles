import {
  AgentSession,
  InteractiveMode,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
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
const ATTACHED_LABEL_PATTERN = /^Attached \[#image ([1-9]\d*)\]$/;
const PLACEHOLDER_PATTERN = /^\[#image ([1-9]\d*)\]$/;
const CLIPBOARD_IMAGE_PATH_PATTERN =
  /(^|[\s"'`([{<])((?:\/[^\s"'`()\[\]{}<>]+)*\/pi-clipboard-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(?:png|jpe?g|gif|webp))(?=$|[\s"'`)\]}>,.!?;:])/g;

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
    hash?: string;
  };
};

type SubmittedAttachment = {
  label: string;
  image: ImageBlock;
};

type RenderPatchState = {
  originalAddMessageToChat: (message: any, options?: any) => void;
};

type PromptPatchState = {
  originalRunAgentPrompt: (messages: any) => Promise<void>;
};

type LoadedImage = {
  data: string;
  hash: string;
  mimeType: string;
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

      lines.push("");
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

function idFromText(block: unknown): number | undefined {
  if (!isTextBlock(block)) return undefined;
  const attachedMatch = block.text.match(ATTACHED_LABEL_PATTERN);
  if (attachedMatch?.[1]) return Number(attachedMatch[1]);

  const placeholderMatch = block.text.match(PLACEHOLDER_PATTERN);
  if (placeholderMatch?.[1]) return Number(placeholderMatch[1]);

  return undefined;
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

    for (let index = 0; index < content.length; index++) {
      const block = content[index];
      if (!isImageBlock(block)) continue;

      const id = idFromImage(block) ?? idFromText(content[index - 1]);
      max = id ? Math.max(max, id) : max + 1;
    }
  }

  return max;
}

function detectSupportedMimeType(
  path: string,
  bytes: Buffer,
): string | undefined {
  const extension = extname(path).toLowerCase();

  if (
    extension === ".png" &&
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    (extension === ".jpg" || extension === ".jpeg") &&
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    extension === ".gif" &&
    bytes.length >= 6 &&
    (bytes.subarray(0, 6).toString("ascii") === "GIF87a" ||
      bytes.subarray(0, 6).toString("ascii") === "GIF89a")
  ) {
    return "image/gif";
  }

  if (
    extension === ".webp" &&
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  return undefined;
}

function loadClipboardImage(path: string): LoadedImage | undefined {
  try {
    const bytes = readFileSync(path);
    const mimeType = detectSupportedMimeType(path, bytes);
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

function replaceClipboardImagePaths(
  text: string,
  nextId: number,
): {
  attachments: SubmittedAttachment[];
  text: string;
} {
  const attachments: SubmittedAttachment[] = [];

  const replaced = text.replace(
    CLIPBOARD_IMAGE_PATH_PATTERN,
    (match: string, prefix: string, path: string) => {
      const loaded = loadClipboardImage(path);
      if (!loaded) return match;

      const id = nextId + attachments.length;
      const placeholder = `[#image ${id}]`;
      const label = `Attached ${placeholder}`;
      const image: ImageBlock = {
        type: "image",
        data: loaded.data,
        mimeType: loaded.mimeType,
        piImageMeta: {
          id,
          label,
          hash: loaded.hash,
        },
      };

      attachments.push({ label, image });
      return `${prefix}${placeholder}`;
    },
  );

  return { attachments, text: replaced };
}

function transformClipboardImagePaths(
  message: any,
  nextId: number,
): {
  count: number;
  message: any;
} {
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

    const result = replaceClipboardImagePaths(block.text, nextId + count);
    content.push({ ...block, text: result.text });

    for (const attachment of result.attachments) {
      content.push(attachment.image);
    }

    count += result.attachments.length;
  }

  return count === 0
    ? { count, message }
    : { count, message: { ...message, content } };
}

function patchPromptContent() {
  const prototype = AgentSession.prototype as any;
  const state = (prototype[PROMPT_PATCH_STATE] ??= {
    originalRunAgentPrompt: prototype._runAgentPrompt,
  }) as PromptPatchState;

  prototype._runAgentPrompt = function patchedRunAgentPrompt(messages: any) {
    const existingMax = maxSubmittedImageId(this?.agent?.state?.messages);
    let nextId = existingMax + 1;

    const transform = (message: any) => {
      const result = transformClipboardImagePaths(message, nextId);
      nextId += result.count;
      return result.message;
    };

    const transformed = Array.isArray(messages)
      ? messages.map(transform)
      : transform(messages);

    return state.originalRunAgentPrompt.call(this, transformed);
  };
}

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
      new SubmittedImagesComponent(attachments, themeForInteractiveMode(this)),
    );
  };
}

export default function (_pi: ExtensionAPI) {
  patchPromptContent();
  patchUserMessageRendering();
}
