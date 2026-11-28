import { Editor, type Extensions } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorProps, EditorView } from '@tiptap/pm/view';

import { type EditorDriver, UnsupportedStep } from './driver';
import type { Step } from './steps';

// `Mod` is Cmd or Ctrl depending on the OS the tests run on, by the same test
// prosemirror-keymap uses, so a case must not depend on which one it is.
const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iP(hone|[oa]d)/.test(navigator.platform);

// The modifier names prosemirror-keymap accepts.
const MODIFIERS: [RegExp, 'alt' | 'ctrl' | 'meta' | 'shift' | 'mod'][] = [
  [/^(cmd|meta|m)$/i, 'meta'],
  [/^a(lt)?$/i, 'alt'],
  [/^(c|ctrl|control)$/i, 'ctrl'],
  [/^s(hift)?$/i, 'shift'],
  [/^mod$/i, 'mod'],
];

// The browser moves the caret for these, and there is no layout to move it by.
const CARET_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

const LAYOUT_METHODS = new Set([
  'coordsAtPos',
  'posAtCoords',
  'endOfTextblock',
]);

interface KeyPress {
  event: KeyboardEvent;
  hasModifier: boolean;
}

function keyCodeOf(key: string): number {
  // Keymaps fall back to the key code to resolve shortcuts held with Shift.
  return /^[a-z0-9]$/i.test(key) ? key.toUpperCase().charCodeAt(0) : 0;
}

export function toKeyEvent(shortcut: string): KeyPress {
  const parts = shortcut.split(/-(?!$)/);
  const last = parts.at(-1) ?? '';
  const key = last === 'Space' ? ' ' : last;
  const held = new Set<string>();
  for (const part of parts.slice(0, -1)) {
    const modifier = MODIFIERS.find(([pattern]) => pattern.test(part))?.[1];
    if (!modifier) {
      throw new Error(`Unknown modifier "${part}" in ${shortcut}`);
    }
    held.add(modifier === 'mod' ? (isMac ? 'meta' : 'ctrl') : modifier);
  }
  const shiftKey = held.has('shift');
  const event = {
    key: key.length === 1 && shiftKey ? key.toUpperCase() : key,
    keyCode: keyCodeOf(key),
    shiftKey,
    altKey: held.has('alt'),
    ctrlKey: held.has('ctrl'),
    metaKey: held.has('meta'),
    preventDefault() {},
  } as KeyboardEvent;
  return { event, hasModifier: held.size > 0 };
}

function graphemes(text: string): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(text), ({ segment }) => segment);
}

/**
 * Drives a headless editor by calling the hooks a view would call, in the
 * order the view calls them. There is no DOM, so it covers keymaps and input
 * rules but nothing the browser does on its own: paste, composition, caret
 * movement. A caret key that no handler takes skips the case.
 */
export function createNodeDriver(
  extensions: Extensions,
  editorProps: EditorProps = {},
): EditorDriver {
  const editor = new Editor({
    element: null,
    extensions,
    editorProps,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  });
  // A headless editor's state has no plugins.
  editor.view.updateState(
    editor.state.reconfigure({ plugins: editor.extensionManager.plugins }),
  );
  // The headless view throws for anything only a mounted view has. Its DOM
  // is given as an element outside any document, and a handler that asks
  // for layout gives the case up, as caret movement does.
  const view: EditorView = new Proxy(editor.view, {
    get: (target, key) => {
      if (key === 'dom') {
        return {};
      }
      if (typeof key === 'string' && LAYOUT_METHODS.has(key)) {
        return () => {
          throw new UnsupportedStep(`There is no layout for view.${key}`);
        };
      }
      return Reflect.get(target, key);
    },
  });

  // Like EditorView.someProp: the view's own props come before the plugins'.
  function someProp<K extends keyof EditorProps>(
    name: K,
    call: (prop: NonNullable<EditorProps[K]>) => unknown,
  ): boolean {
    const own = editorProps[name];
    if (own && call(own as NonNullable<EditorProps[K]>)) {
      return true;
    }
    return editor.state.plugins.some((plugin) => {
      const prop = plugin.props[name];
      return prop ? Boolean(call(prop as NonNullable<EditorProps[K]>)) : false;
    });
  }

  function keyDown(event: KeyboardEvent): boolean {
    return someProp('handleKeyDown', (handle) => handle(view, event));
  }

  function typeChar(char: string): void {
    if (keyDown(toKeyEvent(char === ' ' ? 'Space' : char).event)) {
      return;
    }
    const { from, to } = editor.state.selection;
    const handled = someProp('handleTextInput', (handle) =>
      handle(view, from, to, char),
    );
    if (!handled) {
      view.dispatch(editor.state.tr.insertText(char, from, to));
    }
  }

  // What the browser does with Backspace and Delete when no keymap takes them.
  function deleteNatively(key: 'Backspace' | 'Delete'): void {
    const range = nativeDeletion(key);
    if (!range) {
      return;
    }
    const { doc, tr } = editor.state;
    // The view reads the deletion and the caret from the DOM, and keeps what
    // was deleted marked as it was for the text typed next.
    const marks = doc.resolve(range.from).marksAcross(doc.resolve(range.to));
    tr.delete(range.from, range.to);
    tr.setSelection(TextSelection.create(tr.doc, range.from));
    if (marks) {
      tr.ensureMarks(marks);
    }
    view.dispatch(tr);
  }

  function nativeDeletion(
    key: 'Backspace' | 'Delete',
  ): { from: number; to: number } | null {
    const { selection } = editor.state;
    if (!selection.empty) {
      return { from: selection.from, to: selection.to };
    }
    if (!(selection instanceof TextSelection) || !selection.$cursor) {
      return null;
    }
    const { $cursor } = selection;
    if (key === 'Backspace' && $cursor.parentOffset > 0) {
      const before = $cursor.nodeBefore;
      const size = before?.isText
        ? (graphemes(before.text ?? '').at(-1)?.length ?? 1)
        : (before?.nodeSize ?? 1);
      return { from: $cursor.pos - size, to: $cursor.pos };
    }
    if (
      key === 'Delete' &&
      $cursor.parentOffset < $cursor.parent.content.size
    ) {
      const after = $cursor.nodeAfter;
      const size = after?.isText
        ? (graphemes(after.text ?? '')[0]?.length ?? 1)
        : (after?.nodeSize ?? 1);
      return { from: $cursor.pos, to: $cursor.pos + size };
    }
    return null;
  }

  function pressKey(shortcut: string): void {
    const { event, hasModifier } = toKeyEvent(shortcut);
    if (!hasModifier && event.key.length === 1) {
      typeChar(event.key);
      return;
    }
    if (keyDown(event)) {
      return;
    }
    const { key, altKey, ctrlKey, metaKey } = event;
    if (
      (key === 'Backspace' || key === 'Delete') &&
      !altKey &&
      !ctrlKey &&
      !metaKey
    ) {
      deleteNatively(key);
      return;
    }
    if (CARET_KEYS.has(key)) {
      throw new UnsupportedStep(
        `Only a browser moves the caret for ${shortcut}`,
      );
    }
    throw new Error(`No keymap handles ${shortcut}`);
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
