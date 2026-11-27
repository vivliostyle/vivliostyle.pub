import { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';

import { getMarkdown, PubExtensions } from '@v/tiptap-extensions';
import {
  attributedMarkOf,
  isMathSource,
  nextFootnoteLabel,
  selectedNodeOf,
  selectedRuby,
  setMarkAttributes,
} from './vfm';

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function load(markdown: string): Editor {
  editor = new Editor({
    element: null,
    extensions: [PubExtensions.configure({})],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  });
  editor.commands.setMarkdown(markdown);
  return editor;
}

/** Selects from the first occurrence of `text`, `length` characters on. */
function selectText(editor: Editor, text: string, length = text.length): void {
  let from = -1;
  editor.state.doc.descendants((node, pos) => {
    if (from === -1 && node.isText && node.text?.includes(text)) {
      from = pos + node.text.indexOf(text);
    }
  });
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, from, from + length),
    ),
  );
}

describe('isMathSource', () => {
  it.each([
    ['x^2', false, true],
    [' x', false, false],
    ['x ', false, false],
    ['a$b', false, false],
    ['\ny = 1\n', true, true],
    ['\n- a\n', true, false],
    ['a\n\nb', true, false],
  ])('%j as display %s is %s', (latex, display, expected) => {
    expect(isMathSource(load(''), latex, display)).toBe(expected);
  });
});

describe('nextFootnoteLabel', () => {
  it('follows the largest number among references and definitions', () => {
    const editor = load('a[^2] b[^note]\n\n[^7]: seven\n');
    expect(nextFootnoteLabel(editor.state.doc)).toBe('8');
  });

  it('starts at 1', () => {
    expect(nextFootnoteLabel(load('text').state.doc)).toBe('1');
  });
});

describe('selected VFM nodes', () => {
  it('finds the ruby the caret is in', () => {
    const editor = load('{漢字|かんじ}');
    selectText(editor, '漢', 0);
    expect(selectedRuby(editor.state)?.attrs.rubyText).toBe('かんじ');
  });

  it('finds selected math', () => {
    const editor = load('a $x$ b');
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 3)),
    );
    expect(selectedNodeOf(editor.state, 'math')?.attrs.latex).toBe('x');
  });
});

describe('attributes of the selected element', () => {
  it('are those of the mark that reaches furthest', () => {
    const editor = load('**a *b* c**{.x}');
    selectText(editor, 'b');
    expect(attributedMarkOf(editor.state)?.mark.type.name).toBe('bold');
  });

  it('are written after the element', () => {
    const editor = load('a **bold** c');
    selectText(editor, 'old');
    const target = attributedMarkOf(editor.state);
    expect(target).not.toBeNull();
    if (target) {
      setMarkAttributes(editor, target, { id: 'i', class: 'x y' });
    }
    expect(getMarkdown(editor)).toBe('a **bold**{#i .x .y} c');
  });

  it('can be taken away', () => {
    const editor = load('`c`{.y} d');
    selectText(editor, 'c');
    const target = attributedMarkOf(editor.state);
    if (target) {
      setMarkAttributes(editor, target, null);
    }
    expect(getMarkdown(editor)).toBe('`c` d');
  });

  it('are refused where markdown or the DOM cannot hold them', () => {
    const editor = load('a **bold** c');
    selectText(editor, 'old');
    const target = attributedMarkOf(editor.state);
    expect(target).not.toBeNull();
    if (target) {
      expect(
        setMarkAttributes(editor, target, { 'http://example.com': '' }),
      ).toBe(false);
      expect(setMarkAttributes(editor, target, { k: 'a b\\' })).toBe(false);
    }
    expect(getMarkdown(editor)).toBe('a **bold** c');
  });

  it('are not there without an element', () => {
    const editor = load('plain text');
    selectText(editor, 'text');
    expect(attributedMarkOf(editor.state)).toBeNull();
  });
});
