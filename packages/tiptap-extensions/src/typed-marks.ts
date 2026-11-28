import {
  type AnyExtension,
  Extension,
  Mark as MarkExtension,
} from '@tiptap/core';
import { Mark } from '@tiptap/pm/model';
import { Plugin, TextSelection, type Transaction } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';

/**
 * Makes the mark of an extension apply to typed text only where the text on
 * both sides of the caret has it, so none at the edges of the mark.
 */
export function withoutInclusiveMark(extension: AnyExtension): AnyExtension {
  return extension instanceof MarkExtension
    ? extension.extend({ inclusive: false })
    : extension;
}

/** Whether the transaction puts inline content at the caret and nothing else, as typing does. */
export function typesAtCaret(tr: Transaction): boolean {
  const [step] = tr.steps;
  return (
    tr.steps.length === 1 &&
    step instanceof ReplaceStep &&
    step.slice.size > 0 &&
    step.slice.openStart === 0 &&
    step.slice.openEnd === 0 &&
    tr.selection.empty &&
    tr.selection.head === step.from + step.slice.size
  );
}

// Whether the stored marks are those the view keeps when it reads a deletion
// the browser made from the DOM.
function keepsDeletedMarks(tr: Transaction): boolean {
  const [step] = tr.steps;
  if (
    !tr.storedMarks ||
    tr.steps.length !== 1 ||
    !(step instanceof ReplaceStep) ||
    step.slice.size > 0
  ) {
    return false;
  }
  const doc = tr.docs[0];
  const deleted = doc?.resolve(step.from).marksAcross(doc.resolve(step.to));
  return Boolean(deleted && Mark.sameSet(deleted, tr.storedMarks));
}

/**
 * Text typed at the caret takes the marks of where the caret is, whatever
 * was there before. Where the browser deletes text itself, the view keeps
 * the marks of what it deleted for the text typed next; they are dropped.
 * Only text typed right after text typed with a mark turned on at the caret
 * takes that mark too, so that it goes on past the first character.
 */
export const TypedMarks = Extension.create({
  name: 'typedMarks',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (transactions, _, state) => {
          const last = transactions.findLast((tr) => tr.storedMarksSet);
          if (state.storedMarks && last && keepsDeletedMarks(last)) {
            return state.tr.setStoredMarks(null);
          }
          const { selection } = state;
          if (
            state.storedMarks ||
            !(selection instanceof TextSelection) ||
            !selection.$cursor ||
            !transactions.some(typesAtCaret)
          ) {
            return null;
          }
          const typed = selection.$cursor.nodeBefore?.marks;
          return typed && !Mark.sameSet(typed, selection.$cursor.marks())
            ? state.tr.setStoredMarks(typed)
            : null;
        },
      }),
    ];
  },
});
