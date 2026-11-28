import type { EditorState } from '@tiptap/pm/state';
import { AllSelection, NodeSelection, TextSelection } from '@tiptap/pm/state';

// Inline nodes without text of their own, whose commands the toolbar holds.
const SELECTABLE_INLINE_NODES = new Set(['math', 'footnoteReference']);

/** Whether the selection is one the selection toolbar shows for. */
export function hasToolbarSelection(state: EditorState): boolean {
  const { selection } = state;
  if (selection instanceof NodeSelection) {
    return SELECTABLE_INLINE_NODES.has(selection.node.type.name);
  }
  if (
    selection.empty ||
    !(selection instanceof TextSelection || selection instanceof AllSelection)
  ) {
    return false;
  }
  return state.doc.textBetween(selection.from, selection.to).length > 0;
}
