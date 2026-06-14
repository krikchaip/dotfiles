/**
 * Atomic image placeholder editing.
 *
 * Makes active [#image N] placeholders behave as a single editor token for
 * word movement/deletion while leaving the draft attachment feature removable.
 */

import { Editor } from "@earendil-works/pi-tui";
import type { ImageAttachmentsDrafts } from "./draft-attachments";

const EDITOR_PATCH_STATE = Symbol.for("pi-image-attachments.editor.patch");

type EditorPatchState = {
  originalSegment: (text: string, mode: "word" | "grapheme") => Iterable<any>;
  originalHandleBackspace: () => void;
  originalHandleForwardDelete: () => void;
  originalDeleteWordBackwards: () => void;
  originalDeleteWordForward: () => void;
  originalMoveWordBackwards?: () => void;
  originalMoveWordForwards?: () => void;
  originalDeleteToStartOfLine: () => void;
  originalDeleteToEndOfLine: () => void;
};

function segmentWithActivePlaceholders(
  drafts: ImageAttachmentsDrafts,
  text: string,
  baseSegments: Iterable<any>,
): any[] {
  if (!text.includes("[#image ")) return [...baseSegments];

  const spans = drafts.activePlaceholderSpans(text);
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

function isLineWhitespace(char: string | undefined): boolean {
  return !!char && /\s/.test(char);
}

function deleteLineRange(
  editor: any,
  start: number,
  end: number,
  prependKill: boolean,
): void {
  const lineIndex = editor.state.cursorLine;
  const currentLine = editor.state.lines[lineIndex] ?? "";
  const wasKill = editor.lastAction === "kill";

  editor.pushUndoSnapshot();
  editor.killRing?.push?.(currentLine.slice(start, end), {
    prepend: prependKill,
    accumulate: wasKill,
  });
  editor.lastAction = "kill";
  editor.state.lines[lineIndex] =
    currentLine.slice(0, start) + currentLine.slice(end);
  editor.setCursorCol(start);
  editor.onChange?.(editor.getText());
}

function deleteActivePlaceholderBackward(
  drafts: ImageAttachmentsDrafts,
  editor: any,
): boolean {
  const currentLine = editor.state.lines[editor.state.cursorLine] ?? "";
  const cursor = Math.min(editor.state.cursorCol, currentLine.length);
  if (cursor <= 0) return false;

  let lookupCol = cursor;
  while (lookupCol > 0 && isLineWhitespace(currentLine[lookupCol - 1])) {
    lookupCol--;
  }

  const span = drafts
    .activePlaceholderSpans(currentLine)
    .find((item) => lookupCol > item.start && lookupCol <= item.end);
  if (!span) return false;

  deleteLineRange(editor, span.start, Math.max(cursor, span.end), true);
  return true;
}

function deleteActivePlaceholderForward(
  drafts: ImageAttachmentsDrafts,
  editor: any,
): boolean {
  const currentLine = editor.state.lines[editor.state.cursorLine] ?? "";
  const cursor = Math.min(editor.state.cursorCol, currentLine.length);
  if (cursor >= currentLine.length) return false;

  let lookupCol = cursor;
  while (
    lookupCol < currentLine.length &&
    isLineWhitespace(currentLine[lookupCol])
  ) {
    lookupCol++;
  }

  const span = drafts
    .activePlaceholderSpans(currentLine)
    .find((item) => lookupCol >= item.start && lookupCol < item.end);
  if (!span) return false;

  deleteLineRange(
    editor,
    cursor <= span.start ? cursor : span.start,
    span.end,
    false,
  );
  return true;
}

function moveActivePlaceholderBackward(
  drafts: ImageAttachmentsDrafts,
  editor: any,
): boolean {
  const currentLine = editor.state.lines[editor.state.cursorLine] ?? "";
  const cursor = Math.min(editor.state.cursorCol, currentLine.length);
  if (cursor <= 0) return false;

  let lookupCol = cursor;
  while (lookupCol > 0 && isLineWhitespace(currentLine[lookupCol - 1])) {
    lookupCol--;
  }

  const span = drafts
    .activePlaceholderSpans(currentLine)
    .find((item) => lookupCol > item.start && lookupCol <= item.end);
  if (!span) return false;

  editor.setCursorCol(span.start);
  editor.lastAction = null;
  return true;
}

function moveActivePlaceholderForward(
  drafts: ImageAttachmentsDrafts,
  editor: any,
): boolean {
  const currentLine = editor.state.lines[editor.state.cursorLine] ?? "";
  const cursor = Math.min(editor.state.cursorCol, currentLine.length);
  if (cursor >= currentLine.length) return false;

  let lookupCol = cursor;
  while (
    lookupCol < currentLine.length &&
    isLineWhitespace(currentLine[lookupCol])
  ) {
    lookupCol++;
  }

  const span = drafts
    .activePlaceholderSpans(currentLine)
    .find((item) => lookupCol >= item.start && lookupCol < item.end);
  if (!span) return false;

  editor.setCursorCol(span.end);
  editor.lastAction = null;
  return true;
}

export function installAtomicPlaceholder(drafts: ImageAttachmentsDrafts) {
  const prototype = Editor.prototype as any;
  const existing = prototype[EDITOR_PATCH_STATE] as
    | EditorPatchState
    | undefined;
  const state: EditorPatchState = existing ?? {
    originalSegment: prototype.segment,
    originalHandleBackspace: prototype.handleBackspace,
    originalHandleForwardDelete: prototype.handleForwardDelete,
    originalDeleteWordBackwards: prototype.deleteWordBackwards,
    originalDeleteWordForward: prototype.deleteWordForward,
    originalMoveWordBackwards: prototype.moveWordBackwards,
    originalMoveWordForwards: prototype.moveWordForwards,
    originalDeleteToStartOfLine: prototype.deleteToStartOfLine,
    originalDeleteToEndOfLine: prototype.deleteToEndOfLine,
  };

  state.originalMoveWordBackwards ??= prototype.moveWordBackwards;
  state.originalMoveWordForwards ??= prototype.moveWordForwards;
  prototype[EDITOR_PATCH_STATE] = state;

  prototype.segment = function patchedSegment(
    text: string,
    mode: "word" | "grapheme",
  ) {
    drafts.setActiveEditor(this);
    const base = state.originalSegment.call(this, text, mode);
    return segmentWithActivePlaceholders(drafts, text, base);
  };

  prototype.handleBackspace = function patchedHandleBackspace() {
    state.originalHandleBackspace.call(this);
    drafts.reconcileEditorDraft(this);
  };

  prototype.handleForwardDelete = function patchedHandleForwardDelete() {
    state.originalHandleForwardDelete.call(this);
    drafts.reconcileEditorDraft(this);
  };

  prototype.deleteWordBackwards = function patchedDeleteWordBackwards() {
    this.exitHistoryBrowsing?.();
    if (!deleteActivePlaceholderBackward(drafts, this)) {
      state.originalDeleteWordBackwards.call(this);
    }
    drafts.reconcileEditorDraft(this);
  };

  prototype.deleteWordForward = function patchedDeleteWordForward() {
    this.exitHistoryBrowsing?.();
    if (!deleteActivePlaceholderForward(drafts, this)) {
      state.originalDeleteWordForward.call(this);
    }
    drafts.reconcileEditorDraft(this);
  };

  prototype.moveWordBackwards = function patchedMoveWordBackwards() {
    if (!moveActivePlaceholderBackward(drafts, this)) {
      state.originalMoveWordBackwards?.call(this);
    }
  };

  prototype.moveWordForwards = function patchedMoveWordForwards() {
    if (!moveActivePlaceholderForward(drafts, this)) {
      state.originalMoveWordForwards?.call(this);
    }
  };

  prototype.deleteToStartOfLine = function patchedDeleteToStartOfLine() {
    state.originalDeleteToStartOfLine.call(this);
    drafts.reconcileEditorDraft(this);
  };

  prototype.deleteToEndOfLine = function patchedDeleteToEndOfLine() {
    state.originalDeleteToEndOfLine.call(this);
    drafts.reconcileEditorDraft(this);
  };
}
