import { ListKeymap } from '@tiptap/extension-list';
import type { EditorState } from '@tiptap/pm/state';

function isInListItemContinuation(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'listItem') {
      return $from.index(depth) > 0;
    }
  }
  return false;
}

export const PubListKeymap = ListKeymap.extend({
  addKeyboardShortcuts() {
    const shortcuts = this.parent?.() ?? {};
    // ListKeymap lifts the whole item when Backspace is pressed at the start
    // of any block in it; past the first one, ProseMirror's join is wanted.
    const backspace =
      (name: string): (typeof shortcuts)[string] =>
      (props) =>
        !isInListItemContinuation(props.editor.state) &&
        (shortcuts[name]?.(props) ?? false);
    return {
      ...shortcuts,
      Backspace: backspace('Backspace'),
      'Mod-Backspace': backspace('Mod-Backspace'),
    };
  },
});
