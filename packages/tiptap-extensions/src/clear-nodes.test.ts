import { Editor, type JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';

import { PubExtensions } from './index';

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

const paragraph = (text: string): JSONContent => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});
const listItem = (...content: JSONContent[]): JSONContent => ({
  type: 'listItem',
  content,
});
const bulletList = (...content: JSONContent[]): JSONContent => ({
  type: 'bulletList',
  content,
});

const nestedList = bulletList(
  listItem(paragraph('a'), bulletList(listItem(paragraph('b')))),
);

function createEditor(content: JSONContent[]): Editor {
  editor = new Editor({
    element: null,
    extensions: [PubExtensions.configure({})],
    content: { type: 'doc', content },
  });
  editor.commands.selectAll();
  return editor;
}

describe('clearNodes', () => {
  it('works after earlier steps in the same chain', () => {
    const editor = createEditor([nestedList]);
    expect(editor.chain().clearNodes().clearNodes().run()).toBe(true);
    expect(editor.getJSON().content).toEqual([paragraph('a'), paragraph('b')]);
  });

  it('can be followed by a list toggle in the same chain', () => {
    const editor = createEditor([nestedList]);
    expect(editor.chain().clearNodes().toggleOrderedList().run()).toBe(true);
    expect(editor.getJSON().content?.[0]?.type).toBe('orderedList');
  });
});
