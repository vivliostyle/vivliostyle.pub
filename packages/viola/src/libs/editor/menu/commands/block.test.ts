import { Editor, type JSONContent } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { VFM } from '@vivliostyle/vfm';
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

const vfm = VFM({ partial: true });

interface MdastNode {
  type: string;
  value?: string;
  ordered?: boolean | null;
  depth?: number;
  children?: MdastNode[];
}

function mdastName(node: MdastNode): string | undefined {
  switch (node.type) {
    case 'list':
      return node.ordered ? 'ol' : 'ul';
    case 'listItem':
      return 'li';
    case 'blockquote':
      return 'bq';
    case 'heading':
      return `h${node.depth}`;
    case 'code':
      return 'code';
  }
}

const nodeNames: Record<string, string> = {
  bulletList: 'ul',
  orderedList: 'ol',
  listItem: 'li',
  blockquote: 'bq',
  codeBlock: 'code',
};

/** Each text with the lists, items, quotes, headings and code around it. */
function vfmTexts(markdown: string): string[] {
  const texts: string[] = [];
  const walk = (node: MdastNode, path: string) => {
    const name = mdastName(node);
    const current = name ? `${path}/${name}` : path;
    if ((node.type === 'text' || node.type === 'code') && node.value) {
      texts.push(`${current}: ${node.value}`);
    }
    for (const child of node.children ?? []) {
      walk(child, current);
    }
  };
  walk(vfm.parse(markdown) as MdastNode, '');
  return texts;
}

function editorTexts(doc: Node): string[] {
  const texts: string[] = [];
  const walk = (node: Node, path: string) => {
    const name =
      node.type.name === 'heading'
        ? `h${node.attrs.level}`
        : nodeNames[node.type.name];
    const current = name ? `${path}/${name}` : path;
    if (node.isText) {
      texts.push(`${current}: ${node.text}`);
    }
    node.forEach((child) => {
      walk(child, current);
    });
  };
  walk(doc, '');
  return texts;
}

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

describe('block commands in nested blocks', () => {
  const threeLevels = bulletList(
    listItem(
      paragraph('a'),
      bulletList(
        listItem(paragraph('b'), bulletList(listItem(paragraph('c')))),
      ),
    ),
    listItem(paragraph('d')),
  );

  it('reflects the blocks of a select-all selection', () => {
    const editor = createDocEditor([threeLevels]);
    editor.commands.selectAll();
    expect(command('block.bullet-list').isActive?.(editor)).toBe(true);
    expect(command('block.bullet-list').isEnabled?.(editor)).toBe(false);
    expect(command('block.paragraph').isActive?.(editor)).toBe(false);
    expect(command('block.paragraph').isEnabled?.(editor)).toBe(true);
  });

  it('changes only the innermost level of a deeply nested item', () => {
    const editor = createDocEditor([threeLevels]);
    selectTexts(editor, 2, 2);
    command('block.paragraph').run?.({ editor, surface: 'selection' });
    expect(editor.getJSON().content).toEqual([
      bulletList(
        listItem(
          paragraph('a'),
          bulletList(listItem(paragraph('b'), paragraph('c'))),
        ),
        listItem(paragraph('d')),
      ),
    ]);
    expect(command('block.paragraph').isActive?.(editor)).toBe(true);
  });

  it('changes only the list holding the selected item', () => {
    const editor = createDocEditor([threeLevels]);
    selectTexts(editor, 1, 1);
    command('block.ordered-list').run?.({ editor, surface: 'trigger' });
    expect(editorTexts(editor.state.doc)).toEqual([
      '/ul/li: a',
      '/ul/li/ol/li: b',
      '/ul/li/ol/li/ul/li: c',
      '/ul/li: d',
    ]);
  });

  it('keeps the quote around a converted list item', () => {
    const editor = createDocEditor([blockquote(nestedBulletList)]);
    selectTexts(editor, 1, 1);
    command('block.heading-2').run?.({ editor, surface: 'selection' });
    expect(editorTexts(editor.state.doc)).toEqual([
      '/bq/ul/li: a',
      '/bq/ul/li/h2: b',
    ]);
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
        expect(vfmTexts(editor.getMarkdown())).toEqual(
          editorTexts(editor.state.doc),
        );
      });
    }
  }
});
