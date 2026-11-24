import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TextSelection, type Transaction } from '@tiptap/pm/state';

import { serializeDoc } from './editor-io';

/**
 * Stands for the selection in a case's markdown: one mark is the caret, two
 * are the ends of a range. U+2038 has no meaning in Markdown or VFM, so it
 * goes through the parser as ordinary text.
 */
export const CARET = '‸';

export function hasSelectionMarks(markdown: string): boolean {
  return markdown.includes(CARET);
}

/** Removes the marks from the loaded document and selects what they marked. */
export function takeSelectionMarks(editor: Editor): void {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) {
      return;
    }
    let index = node.text.indexOf(CARET);
    while (index !== -1) {
      positions.push(pos + index);
      index = node.text.indexOf(CARET, index + CARET.length);
    }
  });
  if (positions.length === 0) {
    return;
  }
  if (positions.length > 2) {
    throw new Error(`Expected at most two ${CARET} marks`);
  }
  const { tr } = editor.state;
  for (const pos of positions.toReversed()) {
    tr.delete(pos, pos + CARET.length);
  }
  const [anchor, end] = positions;
  const head = end === undefined ? anchor : end - CARET.length;
  tr.setSelection(TextSelection.create(tr.doc, anchor, head));
  editor.view.dispatch(tr.setMeta('addToHistory', false));
}

// A mark at the edge of formatted text goes outside the formatting, so the
// same selection is always written the same way.
function insertMark(tr: Transaction, pos: number): void {
  const $pos = tr.doc.resolve(pos);
  const after = $pos.nodeAfter?.marks ?? [];
  const marks = ($pos.nodeBefore?.marks ?? []).filter((mark) =>
    mark.isInSet(after),
  );
  const text: ProseMirrorNode = tr.doc.type.schema.text(CARET, marks);
  tr.insert(pos, text);
}

/** The document as markdown, with the selection written back as marks. */
export function serializeWithSelectionMarks(editor: Editor): string {
  const { selection } = editor.state;
  if (!(selection instanceof TextSelection)) {
    throw new Error(
      `Only a text selection can be written as ${CARET} marks, got ${selection.toJSON().type}`,
    );
  }
  const { tr } = editor.state;
  if (!selection.empty) {
    insertMark(tr, selection.to);
  }
  insertMark(tr, selection.from);
  return serializeDoc(editor, tr.doc);
}
