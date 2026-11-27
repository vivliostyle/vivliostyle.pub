import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TextSelection, type Transaction } from '@tiptap/pm/state';

import { serializeDoc } from './editor-io';

/**
 * Stands for the selection in a case's markdown: one mark is the caret, two
 * are the ends of a range, without its direction. U+2038 is punctuation to
 * Unicode, so next to `*` or `_` it can change what the parser reads as
 * emphasis; a case has to check that the marks leave the parse as it is.
 */
export const CARET = '‸';

export function countSelectionMarks(markdown: string): number {
  return markdown.split(CARET).length - 1;
}

export function hasSelectionMarks(markdown: string): boolean {
  return markdown.includes(CARET);
}

export function removeSelectionMarks(markdown: string): string {
  return markdown.replaceAll(CARET, '');
}

/**
 * Removes the marks from the loaded document and selects what they marked.
 * Returns how many marks it found in the document's text.
 */
export function takeSelectionMarks(editor: Editor): number {
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
    return 0;
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
  return positions.length;
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
    const type = selection.toJSON().type;
    throw new Error(
      `${CARET} marks can only stand for a text selection, but the steps leave a ${type} selection. Leave the marks out of \`expect\` and check the selection in a \`run\` step.`,
    );
  }
  const { tr } = editor.state;
  if (!selection.empty) {
    insertMark(tr, selection.to);
  }
  insertMark(tr, selection.from);
  return serializeDoc(editor, tr.doc);
}
