import type { NodeType, Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  type EditorState,
  NodeSelection,
  TextSelection,
  type Transaction,
} from '@tiptap/pm/state';

import { hasInlineContent } from '../../../inline-boundaries';
import { sharedMarks, withoutMarks } from './input-rules';

export interface FoundNode {
  pos: number;
  node: ProseMirrorNode;
}

/**
 * The innermost node of the type that holds the selection, or that the
 * selection is.
 */
export function findSelectedInline(
  state: EditorState,
  name: string,
): FoundNode | null {
  const { selection } = state;
  if (selection instanceof NodeSelection && selection.node.type.name === name) {
    return { pos: selection.from, node: selection.node };
  }
  const { $from, $to } = selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === name) {
      const pos = $from.before(depth);
      return $to.pos <= pos + node.nodeSize - 1 ? { pos, node } : null;
    }
  }
  return null;
}

/**
 * As findSelectedInline, or the node right before or after the caret. The
 * caret does not rest at the edges inside a node with content, so a node of
 * one character never holds it.
 */
export function findInlineAtCaret(
  state: EditorState,
  name: string,
): FoundNode | null {
  const found = findSelectedInline(state, name);
  const { selection } = state;
  if (found || !(selection instanceof TextSelection) || !selection.$cursor) {
    return found;
  }
  const { $cursor } = selection;
  const before = $cursor.nodeBefore;
  if (before?.type.name === name && hasInlineContent(before)) {
    return { pos: $cursor.pos - before.nodeSize, node: before };
  }
  const after = $cursor.nodeAfter;
  if (after?.type.name === name && hasInlineContent(after)) {
    return { pos: $cursor.pos, node: after };
  }
  return null;
}

/**
 * Makes the selected inline content the content of a new node, which takes
 * the marks all of it has. False when the selection is not inline content of
 * one textblock that can hold the node.
 */
export function wrapSelection(
  state: EditorState,
  tr: Transaction,
  type: NodeType,
  attrs: Record<string, unknown> | null,
  dispatch: boolean,
  {
    oneLine = false,
    unmarked = [],
  }: {
    /** The content cannot hold a line break. */
    oneLine?: boolean;
    /** Marks the node cannot have, which its content keeps instead. */
    unmarked?: readonly string[];
  } = {},
): boolean {
  const { from, to, empty, $from, $to } = state.selection;
  if (
    empty ||
    !$from.sameParent($to) ||
    !$from.parent.isTextblock ||
    $from.parent.type.spec.code ||
    !$from.parent.canReplaceWith($from.index(), $to.indexAfter(), type)
  ) {
    return false;
  }
  const content = state.doc.slice(from, to).content;
  if (oneLine) {
    let breaks = false;
    content.descendants((node) => {
      breaks ||=
        Boolean(node.type.spec.linebreakReplacement) ||
        Boolean(node.isText && node.text?.includes('\n'));
    });
    if (breaks) {
      return false;
    }
  }
  const marks = sharedMarks(content).filter(
    (mark) => !unmarked.includes(mark.type.name),
  );
  if (dispatch) {
    tr.replaceWith(
      from,
      to,
      type.create(attrs, withoutMarks(content, marks), marks),
    );
  }
  return true;
}

/**
 * Replaces a node with its content, which takes the node's marks. A
 * selection in the content stays on the same text.
 */
export function unwrap(tr: Transaction, { pos, node }: FoundNode): Transaction {
  const children: ProseMirrorNode[] = [];
  node.forEach((child) => {
    children.push(
      child.mark(
        node.marks.reduce((set, mark) => mark.addToSet(set), child.marks),
      ),
    );
  });
  const { from, to } = tr.selection;
  const inside = (at: number) => at > pos && at < pos + node.nodeSize;
  tr.replaceWith(pos, pos + node.nodeSize, children);
  if (inside(from) && inside(to)) {
    tr.setSelection(TextSelection.create(tr.doc, from - 1, to - 1));
  }
  return tr;
}

/** Inserts an inline node in place of the selection, with the marks there. */
export function insertInline(
  state: EditorState,
  tr: Transaction,
  node: ProseMirrorNode,
  dispatch: boolean,
  /** Marks there that the node cannot have. */
  unmarked: readonly string[] = [],
): boolean {
  const { $from, $to } = state.selection;
  if (
    !$from.sameParent($to) ||
    !$from.parent.isTextblock ||
    $from.parent.type.spec.code ||
    !$from.parent.canReplaceWith($from.index(), $to.indexAfter(), node.type)
  ) {
    return false;
  }
  if (dispatch) {
    tr.replaceSelectionWith(
      node.mark(
        $from.marks().filter((mark) => !unmarked.includes(mark.type.name)),
      ),
      false,
    );
  }
  return true;
}
