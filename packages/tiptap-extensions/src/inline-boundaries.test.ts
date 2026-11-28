import { Editor } from '@tiptap/core';
import { EditorState, type Plugin, TextSelection } from '@tiptap/pm/state';
import type { DecorationSet, EditorView } from '@tiptap/pm/view';
import { afterAll, describe, expect, it } from 'vitest';

import { PubExtensions } from './index';
import { crossing } from './inline-boundaries';
import { parseMarkdown } from './markdown/extension';

const editor = new Editor({
  element: null,
  extensions: [PubExtensions.configure({})],
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
});

afterAll(() => {
  editor.destroy();
});

const plugins = editor.extensionManager.plugins;
const boundaries = plugins.find((plugin) =>
  (plugin as unknown as { key: string }).key.startsWith('inlineBoundaries'),
) as Plugin<DecorationSet>;

function stateOf(markdown: string): EditorState {
  return EditorState.create({
    doc: parseMarkdown(editor, markdown).doc,
    plugins,
  });
}

function widgets(state: EditorState): { pos: number; side: string }[] {
  return (boundaries.getState(state)?.find() ?? []).map((it) => ({
    pos: it.from,
    side: (it.spec as { key: string }).key,
  }));
}

/** The position where `text` starts in the document, plus `offset`. */
function at(state: EditorState, text: string, offset = 0): number {
  let found: number | undefined;
  state.doc.descendants((node, pos) => {
    const index = node.isText ? (node.text ?? '').indexOf(text) : -1;
    if (found === undefined && index !== -1) {
      found = pos + index + offset;
    }
  });
  if (found === undefined) {
    throw new Error(`No text holds ${text}`);
  }
  return found;
}

describe('the boundaries of inline nodes with content', () => {
  it('stand on both sides of a note', () => {
    const state = stateOf('a^[注]b');
    // doc(paragraph("a", inlineFootnote("注"), "b"))
    expect(widgets(state)).toEqual([
      { pos: 2, side: 'inline-boundary-before' },
      { pos: 5, side: 'inline-boundary-after' },
    ]);
  });

  it('follow the note as the document changes', () => {
    let state = stateOf('a^[注]b\n\nc');
    state = state.apply(state.tr.insertText('XY', 1));
    expect(widgets(state).map((it) => it.pos)).toEqual([4, 7]);
    state = state.apply(state.tr.insertText('Z', at(state, '注', 1)));
    expect(widgets(state).map((it) => it.pos)).toEqual([4, 8]);
    const note = state.doc.firstChild?.child(1);
    if (!note) {
      throw new Error('No note');
    }
    const end = at(state, 'c', 1);
    state = state.apply(state.tr.insert(end, note));
    expect(widgets(state).map((it) => it.pos)).toEqual([4, 8, 12, 16]);
    state = state.apply(state.tr.delete(4, 8));
    expect(widgets(state).map((it) => it.pos)).toEqual([8, 12]);
  });

  it('are not part of the document', () => {
    const state = stateOf('a^[注]b');
    expect(state.doc.textContent).toBe('a注b');
  });
});

describe('arrows over the edges of a note', () => {
  const move = (state: EditorState, pos: number, forward: boolean) =>
    crossing(
      state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos))),
      forward,
    );

  it('step over a note of one character as over the character', () => {
    const state = stateOf('a^[注]b');
    // a|^[注]b  ->  a^[注]|b
    expect(move(state, 2, true)).toBe(5);
    expect(move(state, 5, false)).toBe(2);
  });

  it('step into and out of a ruby with one keypress each', () => {
    const state = stateOf('a{漢字|かんじ}b');
    // doc(paragraph("a", ruby("漢字"), "b"))
    expect(move(state, at(state, 'a', 1), true)).toBe(at(state, '字'));
    expect(move(state, at(state, '字'), true)).toBe(at(state, 'b'));
    expect(move(state, at(state, 'b'), false)).toBe(at(state, '字'));
    expect(move(state, at(state, '字'), false)).toBe(at(state, 'a', 1));
  });

  it('step over a whole character', () => {
    const state = stateOf('𠮷{𠮷野家|よしのや}𠮷');
    // doc(paragraph("𠮷", ruby("𠮷野家"), "𠮷"))
    expect(move(state, 3, true)).toBe(6);
    expect(move(state, 9, false)).toBe(7);
    expect(move(state, 6, false)).toBe(3);
  });

  it('step over math', () => {
    const state = stateOf('a^[$x$]b');
    // doc(paragraph("a", inlineFootnote(math), "b"))
    expect(move(state, 2, true)).toBe(5);
    expect(move(state, 5, false)).toBe(2);
  });

  it('step over a line break at the edge', () => {
    // a^[|\\\n注]b  is where the caret cannot rest.
    expect(move(stateOf('a^[\\\n注]b'), 2, true)).toBe(4);
    expect(move(stateOf('a^[注\\\n]b'), 4, true)).toBe(6);
  });

  it('step into a node at the edge of a node', () => {
    // a|^[{漢字|かんじ}]  ->  a^[{漢|字|かんじ}]
    expect(move(stateOf('a^[{漢字|かんじ}]'), 2, true)).toBe(5);
  });

  it('stop outside the node with no character beyond it', () => {
    expect(move(stateOf('^[注]'), 1, true)).toBe(4);
    expect(move(stateOf('^[注]'), 4, false)).toBe(1);
    expect(move(stateOf('a^[注]\\\nb'), 2, true)).toBe(5);
    // a^[注]|{漢|かん}
    expect(move(stateOf('a^[注]{漢|かん}'), 2, true)).toBe(5);
  });

  it('step out of an empty note past the character beyond it', () => {
    // a^[|]b  ->  a^[]b|
    expect(move(stateOf('a^[]b'), 3, true)).toBe(5);
  });

  it('leave text alone', () => {
    const state = stateOf('ab^[注]');
    expect(move(state, 1, true)).toBeNull();
    expect(move(state, 2, false)).toBeNull();
  });

  it('move the caret when an arrow is pressed', () => {
    let state = stateOf('a^[注]b');
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 2)),
    );
    const view = {
      get state() {
        return state;
      },
      dispatch: (tr: Parameters<EditorView['dispatch']>[0]) => {
        state = state.apply(tr);
      },
      dom: {},
    } as unknown as EditorView;
    const press = (key: string, shiftKey = false) =>
      boundaries.props.handleKeyDown?.call(boundaries, view, {
        key,
        shiftKey,
      } as KeyboardEvent);
    expect(press('ArrowRight', true)).toBe(false);
    expect(press('ArrowRight')).toBe(true);
    expect(state.selection.from).toBe(5);
    expect(press('ArrowRight')).toBe(false);
  });
});
