import {
  InteractiveMode,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

const values = JSON.parse(process.env.IMAGE_ATTACHMENTS_CLIPBOARD_VALUES ?? "[]") as string[];
let index = 0;

const prototype = InteractiveMode.prototype as any;
prototype.handleClipboardPaste = async function imageAttachmentsClipboardFixture() {
  const value = values[index++] ?? "";
  this.editor.insertTextAtCursor?.(value);
  this.ui.requestRender();
};

export default function imageAttachmentsClipboardSequence(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, context) => {
    context.ui.setStatus("image-clipboard-e2e", "IMAGE_CLIPBOARD_SEQUENCE_READY");
  });
}
