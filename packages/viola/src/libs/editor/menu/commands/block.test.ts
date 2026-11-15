import { Editor, type JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';

import { PubExtensions } from '@v/tiptap-extensions';
import { getEditorMenuCommand } from '../registry';
import './block';

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function createDocEditor(content: JSONContent[]): Editor {
  editor = new Editor({
    element: null,
    extensions: [PubExtensions.configure({})],
    content: { type: 'doc', content },
  });
  return editor;
}

function createEditor(block: JSONContent): Editor {
  const editor = createDocEditor([block]);
  editor.commands.setTextSelection({ from: 1, to: 2 });
  return editor;
}

function command(id: string) {
  const found = getEditorMenuCommand(id);
  if (!found) {
    throw new Error(`${id} is not registered`);
  }
  return found;
}

const codeBlock: JSONContent = {
  type: 'codeBlock',
  attrs: { language: 'js' },
  content: [{ type: 'text', text: 'a\nb' }],
};

const paragraph = (text: string): JSONContent => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});
const node =
  (type: string) =>
  (...content: JSONContent[]): JSONContent => ({ type, content });
const listItem = node('listItem');
const bulletList = node('bulletList');
const orderedList = node('orderedList');
const blockquote = node('blockquote');

const nestedBulletList = bulletList(
  listItem(paragraph('a'), bulletList(listItem(paragraph('b')))),
);

describe('block commands', () => {
  it('can turn a code block into a list', () => {
    const editor = createEditor(codeBlock);
    expect(command('block.bullet-list').isEnabled?.(editor)).toBe(true);
    command('block.bullet-list').run?.({ editor, surface: 'selection' });
    expect(editor.getJSON().content?.[0]?.type).toBe('bulletList');
  });

  it('can turn a heading into a list', () => {
    const editor = createEditor({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'title' }],
    });
    expect(command('block.ordered-list').isEnabled?.(editor)).toBe(true);
  });

  it('can turn a fully selected nested list into another list type', () => {
    const editor = createDocEditor([nestedBulletList]);
    editor.commands.selectAll();
    expect(command('block.ordered-list').isEnabled?.(editor)).toBe(true);
    command('block.ordered-list').run?.({ editor, surface: 'selection' });
    expect(editor.getJSON().content?.[0]?.type).toBe('orderedList');
  });

  it('keeps code newlines as hard breaks', () => {
    const editor = createEditor(codeBlock);
    command('block.paragraph').run?.({ editor, surface: 'selection' });
    expect(editor.getJSON().content).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'a' },
          { type: 'hardBreak' },
          { type: 'text', text: 'b' },
        ],
      },
    ]);
  });

  it('disables the type the selection already has', () => {
    const editor = createEditor(codeBlock);
    expect(command('block.code-block').isEnabled?.(editor)).toBe(false);
    expect(command('block.paragraph').isEnabled?.(editor)).toBe(true);
  });
});

describe('block commands across nesting levels', () => {
  const shapes: Record<string, JSONContent[]> = {
    'nested bullet list': [nestedBulletList],
    'three-level mixed list': [
      bulletList(
        listItem(
          paragraph('a'),
          orderedList(
            listItem(paragraph('b'), bulletList(listItem(paragraph('c')))),
          ),
        ),
      ),
    ],
    'quote in a list item': [
      orderedList(listItem(paragraph('a'), blockquote(paragraph('b')))),
    ],
    'nested list in a quote': [blockquote(nestedBulletList)],
    'nested list followed by a paragraph': [nestedBulletList, paragraph('c')],
  };

  function selectTexts(editor: Editor, first: number, last: number): void {
    const positions: number[] = [];
    editor.state.doc.descendants((child, pos) => {
      if (child.isText) {
        positions.push(pos);
      }
    });
    editor.commands.setTextSelection({
      from: positions.at(first) ?? 0,
      to: (positions.at(last) ?? 0) + 1,
    });
  }

  const selections: Record<string, (editor: Editor) => void> = {
    'select all': (editor) => editor.commands.selectAll(),
    'first to last text': (editor) => selectTexts(editor, 0, -1),
    'second to last text': (editor) => selectTexts(editor, 1, -1),
    'first to second text': (editor) => selectTexts(editor, 0, 1),
  };

  const blockCommandIds = [
    'block.paragraph',
    'block.heading-1',
    'block.blockquote',
    'block.bullet-list',
    'block.ordered-list',
    'block.code-block',
  ];

  for (const [shapeName, content] of Object.entries(shapes)) {
    for (const [selectionName, select] of Object.entries(selections)) {
      it.each(blockCommandIds)(`${shapeName}, ${selectionName}: %s`, (id) => {
        const editor = createDocEditor(content);
        select(editor);
        expect(() => command(id).isEnabled?.(editor)).not.toThrow();
        expect(() =>
          command(id).run?.({ editor, surface: 'selection' }),
        ).not.toThrow();
        expect(() => editor.state.doc.check()).not.toThrow();
      });
    }
  }
});
