import { type Editor, getMarkRange } from '@tiptap/core';
import type { Mark } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';

/**
 * The href to edit when the selection is exactly one link. Part of a link, or
 * a link plus surrounding text, is a new link over the selection instead.
 */
export function getSelectedLinkHref(state: EditorState): string | null {
  const { selection, schema, doc } = state;
  const type = schema.marks.link;
  if (!type || selection.empty) {
    return null;
  }
  const $from = doc.resolve(selection.from);
  const range = getMarkRange($from, type);
  if (!range || range.from !== selection.from || range.to !== selection.to) {
    return null;
  }
  const href = type.isInSet(
    $from.parent.childAfter($from.parentOffset).node?.marks ?? [],
  )?.attrs.href;
  return typeof href === 'string' ? href : null;
}

export function selectionHasLink(state: EditorState): boolean {
  const type = state.schema.marks.link;
  const { from, to, empty } = state.selection;
  return !!type && !empty && state.doc.rangeHasMark(from, to, type);
}

/**
 * The selected text when it can be retyped as a whole: plain text inside one
 * textblock. Block boundaries and inline nodes such as hard breaks would be
 * destroyed by replacing it with a string.
 */
export function getEditableSelectionText(state: EditorState): string | null {
  const { selection, doc } = state;
  const { $from, $to, empty } = selection;
  if (empty || !$from.sameParent($to) || !$from.parent.isTextblock) {
    return null;
  }
  let onlyText = true;
  doc.nodesBetween($from.pos, $to.pos, (node) => {
    if (node.isInline && !node.isText) {
      onlyText = false;
    }
  });
  return onlyText ? doc.textBetween($from.pos, $to.pos) : null;
}

/**
 * Links the selection. A `text` that differs from the selected text replaces
 * it, keeping only the marks shared by the whole selection; a blank one falls
 * back to the URL.
 * Returns false when the Link extension rejects the URL.
 */
export function setLinkOnSelection(
  editor: Editor,
  { href, text }: { href: string; text?: string },
): boolean {
  if (!editor.can().setLink({ href })) {
    return false;
  }
  const { state } = editor;
  const { from, to } = state.selection;
  if (text === undefined || text === state.doc.textBetween(from, to)) {
    editor.chain().focus().setLink({ href }).run();
    return true;
  }
  let shared: readonly Mark[] | null = null;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isText) {
      shared = shared
        ? shared.filter((mark) => mark.isInSet(node.marks))
        : node.marks;
    }
  });
  const marks = (shared ?? []) as readonly Mark[];
  const link = marks.find((mark) => mark.type.name === 'link');
  const newText = text.trim() || href;
  editor
    .chain()
    .focus()
    .insertContentAt(
      { from, to },
      {
        type: 'text',
        text: newText,
        marks: [
          ...marks.filter((mark) => mark !== link).map((mark) => mark.toJSON()),
          { type: 'link', attrs: { ...link?.attrs, href } },
        ],
      },
    )
    .setTextSelection({ from, to: from + newText.length })
    .run();
  return true;
}

export function removeLinkFromSelection(editor: Editor): void {
  editor.chain().focus().unsetLink().run();
}

/** Returns false when the Link extension rejects the URL. */
export function insertLink(
  editor: Editor,
  { href, text }: { href: string; text?: string },
): boolean {
  if (!editor.can().setLink({ href })) {
    return false;
  }
  editor
    .chain()
    .focus()
    .insertContent({
      type: 'text',
      text: text?.trim() || href,
      marks: [{ type: 'link', attrs: { href } }],
    })
    // The link mark is inclusive, so text typed next would join the link.
    .unsetMark('link')
    .run();
  return true;
}
