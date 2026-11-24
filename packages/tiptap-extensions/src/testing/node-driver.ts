import { Editor, type Extensions } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

import type { EditorDriver } from './driver';
import type { Step } from './steps';

const MODIFIERS = new Set(['Mod', 'Shift', 'Alt', 'Ctrl', 'Meta', 'Cmd']);

// The same test prosemirror-keymap uses to resolve `Mod`.
const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iP(hone|[oa]d)/.test(navigator.platform);

function toKeyEvent(shortcut: string): KeyboardEvent {
  const parts = shortcut.split('-');
  const key = shortcut.endsWith('--') ? '-' : (parts.at(-1) ?? '');
  const modifiers = new Set(parts.filter((part) => MODIFIERS.has(part)));
  const mod = modifiers.has('Mod');
  const shiftKey = modifiers.has('Shift');
  return {
    key: key.length === 1 && shiftKey ? key.toUpperCase() : key,
    keyCode: 0,
    shiftKey,
    altKey: modifiers.has('Alt'),
    ctrlKey: modifiers.has('Ctrl') || (mod && !isMac),
    metaKey: modifiers.has('Meta') || modifiers.has('Cmd') || (mod && isMac),
    preventDefault() {},
  } as KeyboardEvent;
}

/**
 * Drives a headless editor by calling the plugin hooks a view would call.
 * There is no DOM, so it covers keymaps and input rules but nothing the
 * browser does on its own: paste, composition, native caret movement.
 */
export function createNodeDriver(extensions: Extensions): EditorDriver {
  const editor = new Editor({
    element: null,
    extensions,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  });
  // A headless editor's state has no plugins.
  editor.view.updateState(
    editor.state.reconfigure({ plugins: editor.extensionManager.plugins }),
  );
  const view: EditorView = editor.view;

  function typeChar(char: string): void {
    const { from, to } = editor.state.selection;
    const insert = () => editor.state.tr.insertText(char, from, to);
    const handled = editor.state.plugins.some((plugin) =>
      plugin.props.handleTextInput?.call(plugin, view, from, to, char),
    );
    if (!handled) {
      view.dispatch(insert());
    }
  }

  // What the browser does with these keys when no keymap takes them.
  function nativeKey(key: string): void {
    const { selection, tr } = editor.state;
    if (key !== 'Backspace' && key !== 'Delete') {
      return;
    }
    if (!selection.empty) {
      view.dispatch(tr.deleteSelection());
      return;
    }
    if (!(selection instanceof TextSelection) || !selection.$cursor) {
      return;
    }
    const { $cursor } = selection;
    if (key === 'Backspace' && $cursor.parentOffset > 0) {
      const size = $cursor.nodeBefore?.isText
        ? (Array.from($cursor.nodeBefore.text ?? '').at(-1)?.length ?? 1)
        : ($cursor.nodeBefore?.nodeSize ?? 1);
      view.dispatch(tr.delete($cursor.pos - size, $cursor.pos));
    } else if (
      key === 'Delete' &&
      $cursor.parentOffset < $cursor.parent.content.size
    ) {
      const size = $cursor.nodeAfter?.isText
        ? (Array.from($cursor.nodeAfter.text ?? '')[0]?.length ?? 1)
        : ($cursor.nodeAfter?.nodeSize ?? 1);
      view.dispatch(tr.delete($cursor.pos, $cursor.pos + size));
    }
  }

  function pressKey(shortcut: string): void {
    const event = toKeyEvent(shortcut);
    const handled = editor.state.plugins.some((plugin) =>
      plugin.props.handleKeyDown?.call(plugin, view, event),
    );
    if (!handled) {
      nativeKey(event.key);
    }
  }

  return {
    name: 'node',
    editor,
    supports(step: Step) {
      return step.kind !== 'paste' && step.kind !== 'compose';
    },
    async perform(step: Step) {
      switch (step.kind) {
        case 'type':
          for (const char of Array.from(step.text)) {
            typeChar(char);
          }
          return;
        case 'press':
          pressKey(step.key);
          return;
        case 'run':
          step.run(editor);
          return;
        default:
          throw new Error(`The node driver cannot ${step.kind}`);
      }
    },
    destroy() {
      editor.destroy();
    },
  };
}
