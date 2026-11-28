import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';

import { PubExtensions } from '../../../index';
import { selectedRubies } from './ruby';

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

// `a{漢字|かんじ}b`: the ruby is at 2, its base from 3 to 5.
function selectedAt(from: number, to: number): number[] {
  const editor = load('a{漢字|かんじ}b');
  const state = editor.state.apply(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, from, to),
    ),
  );
  return selectedRubies(state)
    .find()
    .map((decoration) => decoration.from);
}

describe('rubies shown selected', () => {
  it('marks a ruby whose whole base is selected', () => {
    expect(selectedAt(1, 7)).toEqual([2]);
    expect(selectedAt(3, 5)).toEqual([2]);
  });

  it('leaves a ruby whose base is selected in part', () => {
    expect(selectedAt(1, 4)).toEqual([]);
    expect(selectedAt(4, 7)).toEqual([]);
  });

  it('marks nothing for a caret', () => {
    expect(selectedAt(3, 3)).toEqual([]);
  });
});
