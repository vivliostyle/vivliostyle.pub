import type { Editor } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export interface InlineTriggerOptions {
  triggers: string[];
  onTrigger: (
    editor: Editor,
    trigger: string,
    from: number,
    coords: { top: number; bottom: number; left: number },
  ) => void;
  isMenuOpen: () => boolean;
  onDismiss: () => void;
}

export const InlineTrigger = Extension.create<InlineTriggerOptions>({
  name: 'inlineTrigger',

  addOptions() {
    return {
      triggers: [],
      onTrigger: () => {},
      isMenuOpen: () => false,
      onDismiss: () => {},
    };
  },

  addProseMirrorPlugins() {
    const { triggers, onTrigger, isMenuOpen, onDismiss } = this.options;
    const editor = this.editor;
    let skipNextDocChange = false;

    return [
      new Plugin({
        key: new PluginKey('inlineTrigger'),
        props: {
          handleKeyDown(_view, event) {
            if (isMenuOpen() && event.key === 'Escape') {
              onDismiss();
              return true;
            }
            return false;
          },
          handleTextInput(view, from, _to, text) {
            if (isMenuOpen()) {
              onDismiss();
              return false;
            }
            const triggerChar = triggers.find((t) => text.endsWith(t));
            if (triggerChar) {
              const triggerOffset = text.length - triggerChar.length;
              const triggerFrom = from + triggerOffset;
              const charBefore =
                triggerOffset > 0
                  ? text[triggerOffset - 1]
                  : view.state.doc.resolve(from).parentOffset === 0
                    ? null
                    : view.state.doc.textBetween(from - 1, from);
              if (charBefore === null || /\s/.test(charBefore)) {
                skipNextDocChange = true;
                const { top, bottom, left } = view.coordsAtPos(triggerFrom);
                onTrigger(editor, triggerChar, triggerFrom, {
                  top,
                  bottom,
                  left,
                });
                return false;
              }
            }
            return false;
          },
        },
        appendTransaction(transactions, _oldState, _newState) {
          if (!isMenuOpen()) return null;
          if (skipNextDocChange) {
            skipNextDocChange = false;
            return null;
          }
          if (transactions.some((tr) => tr.docChanged)) {
            onDismiss();
          }
          return null;
        },
      }),
    ];
  },
});
