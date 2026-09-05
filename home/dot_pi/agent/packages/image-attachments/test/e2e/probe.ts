import { appendFileSync, renameSync, writeFileSync } from "node:fs";
import {
  InteractiveMode,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Editor } from "@earendil-works/pi-tui";

const statePath = process.env.IMAGE_ATTACHMENTS_EDITOR_STATE;
const commandPath = process.env.IMAGE_ATTACHMENTS_COMMAND_CAPTURE;
const EDITOR_PATCH = Symbol.for("image-attachments-e2e.editor-probe");
const CLIPBOARD_PATCH = Symbol.for("image-attachments-e2e.clipboard-probe");

function record(editor: any): void {
  if (!statePath || !editor?.state || typeof editor.getText !== "function") return;
  const temporaryPath = `${statePath}.tmp`;
  writeFileSync(
    temporaryPath,
    JSON.stringify({
      text: editor.getText(),
      cursorLine: editor.state.cursorLine,
      cursorCol: editor.state.cursorCol,
    }),
  );
  renameSync(temporaryPath, statePath);
}

const editorPrototype = Editor.prototype as any;
if (!editorPrototype[EDITOR_PATCH]) {
  const original = editorPrototype.handleInput;
  editorPrototype.handleInput = function imageAttachmentsE2eHandleInput(data: string) {
    const result = original.call(this, data);
    record(this);
    return result;
  };
  editorPrototype[EDITOR_PATCH] = true;
}

const modePrototype = InteractiveMode.prototype as any;
if (!modePrototype[CLIPBOARD_PATCH]) {
  const original = modePrototype.handleClipboardPaste;
  modePrototype.handleClipboardPaste = async function imageAttachmentsE2eClipboardProbe() {
    await original.call(this);
    record(this.editor);
  };
  modePrototype[CLIPBOARD_PATCH] = true;
}

export default function imageAttachmentsE2eProbe(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, context) => {
    context.ui.setStatus("image-attachments-e2e", "IMAGE_ATTACHMENTS_E2E_READY");
  });
  pi.on("session_tree", (_event, context) => {
    context.ui.notify("IMAGE_ATTACHMENTS_SESSION_TREE", "info");
  });
  pi.on("session_compact", (_event, context) => {
    context.ui.notify("IMAGE_ATTACHMENTS_SESSION_COMPACT", "info");
  });

  pi.registerCommand("image-e2e-capture", {
    description: "Capture image attachment command arguments for E2E tests",
    handler: async (args, context) => {
      if (commandPath) appendFileSync(commandPath, `${JSON.stringify(args)}\n`);
      context.ui.notify(`IMAGE_E2E_COMMAND:${args}`, "info");
    },
  });
}
