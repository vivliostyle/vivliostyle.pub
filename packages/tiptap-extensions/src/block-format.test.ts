import {
  Editor,
  getExtensionField,
  getSchemaTypeByName,
  type KeyboardShortcutCommand,
  type Storage,
  sortExtensions,
} from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { afterEach, describe, expect, it } from 'vitest';

import { type BlockFormat, getBlockFormat } from './block-format';
import { PubExtensions } from './index';

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy();
  }
});

function createEditor(markdown: string): Editor {
  const editor = new Editor({
    element: null,
    extensions: [PubExtensions.configure({})],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  });
  editors.push(editor);
  editor.commands.setContent(markdown, { contentType: 'markdown' });
  return editor;
}

const names: Record<string, string> = {
  bulletList: 'ul',
  orderedList: 'ol',
  listItem: 'li',
  blockquote: 'bq',
  paragraph: 'p',
  codeBlock: 'code',
  horizontalRule: 'hr',
};

/** `ul(li(p(a), ul(li(p(b)))))`-style outline of the document's blocks. */
function outline(node: Node): string {
  if (node.isTextblock) {
    const name =
      node.type.name === 'heading'
        ? `h${node.attrs.level}`
        : (names[node.type.name] ?? node.type.name);
    return `${name}(${node.textContent})`;
  }
  const children: string[] = [];
  node.forEach((child) => {
    children.push(outline(child));
  });
  const name = names[node.type.name] ?? node.type.name;
  return node.type.name === 'doc'
    ? children.join(', ')
    : `${name}(${children.join(', ')})`;
}

function reparsedOutline(editor: Editor): string {
  return outline(createEditor(editor.getMarkdown()).state.doc);
}

function textPosition(editor: Editor, text: string): number {
  let found: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (found === undefined && node.text === text) {
      found = pos;
    }
  });
  if (found === undefined) {
    throw new Error(`"${text}" is not in the document`);
  }
  return found;
}

/** Selects from the text `first` to the end of the text `last`; `*` selects all. */
function select(editor: Editor, first: string, last = first): void {
  if (first === '*') {
    editor.commands.selectAll();
    return;
  }
  editor.commands.setTextSelection({
    from: textPosition(editor, first),
    to: textPosition(editor, last) + last.length,
  });
}

function convert(
  markdown: string,
  selection: string,
  format: BlockFormat,
): Editor {
  const editor = createEditor(markdown);
  const [first = '', last] = selection.split('..');
  select(editor, first, last);
  expect(editor.commands.setBlockFormat(format)).toBe(true);
  expect(() => editor.state.doc.check()).not.toThrow();
  return editor;
}

const depth3 = '- a\n  - b\n    - c\n- d';

describe('setBlockFormat', () => {
  it.each<[string, string, BlockFormat, string]>([
    // Nested list items keep their indentation as blocks of the parent item.
    ['- a\n  - b', 'b', 'paragraph', 'ul(li(p(a), p(b)))'],
    ['- a\n  - b', 'b', 'heading-2', 'ul(li(p(a), h2(b)))'],
    ['- a\n  - b', 'b', 'code-block', 'ul(li(p(a), code(b)))'],
    ['- a\n  - b', 'b', 'blockquote', 'ul(li(p(a), bq(p(b))))'],
    [depth3, 'c', 'paragraph', 'ul(li(p(a), ul(li(p(b), p(c)))), li(p(d)))'],
    [depth3, 'c', 'heading-1', 'ul(li(p(a), ul(li(p(b), h1(c)))), li(p(d)))'],
    [depth3, 'b', 'paragraph', 'ul(li(p(a), p(b), ul(li(p(c)))), li(p(d)))'],
    [
      '- a\n  - b\n  - c\n  - d',
      'c',
      'paragraph',
      'ul(li(p(a), ul(li(p(b))), p(c), ul(li(p(d)))))',
    ],
    // Children of an unwrapped item join the rest of the list they end up next to.
    [
      '- x\n- a\n  - b\n- y',
      'a',
      'paragraph',
      'ul(li(p(x))), p(a), ul(li(p(b)), li(p(y)))',
    ],
    // Top-level items and quotes still lift out.
    ['- a\n- b\n- c', 'b', 'heading-1', 'ul(li(p(a))), h1(b), ul(li(p(c)))'],
    ['> a', 'a', 'paragraph', 'p(a)'],
    // Only the list holding the selected items changes type.
    ['- a\n  - b', 'b', 'ordered-list', 'ul(li(p(a), ol(li(p(b)))))'],
    [
      depth3,
      'b',
      'ordered-list',
      'ul(li(p(a), ol(li(p(b), ul(li(p(c)))))), li(p(d)))',
    ],
    [
      '1. a\n   - b\n     1. c',
      'b',
      'ordered-list',
      'ol(li(p(a), ol(li(p(b), ol(li(p(c)))))))',
    ],
    // Lists inside quotes and quotes inside lists keep the outer wrapper.
    ['> - a\n>   - b', 'b', 'paragraph', 'bq(ul(li(p(a), p(b))))'],
    ['> - a\n>   - b', 'b', 'blockquote', 'bq(ul(li(p(a), bq(p(b)))))'],
    ['> - a\n>   - b', 'a', 'heading-1', 'bq(h1(a), ul(li(p(b))))'],
    ['- a\n\n  > b', 'b', 'paragraph', 'ul(li(p(a), p(b)))'],
    ['- a\n\n  > b', 'b', 'bullet-list', 'ul(li(p(a), ul(li(p(b)))))'],
    ['> a\n>\n> > b', 'b', 'paragraph', 'bq(p(a), p(b))'],
    ['> a\n>\n> b\n>\n> c', 'b', 'heading-3', 'bq(p(a)), h3(b), bq(p(c))'],
    // Blocks of a list item turn back into nested items.
    ['- a\n\n  b', 'b', 'bullet-list', 'ul(li(p(a), ul(li(p(b)))))'],
    [
      '- a\n  - x\n\n  b',
      'b',
      'bullet-list',
      'ul(li(p(a), ul(li(p(x)), li(p(b)))))',
    ],
    ['- a\n\n  ## b', 'b', 'ordered-list', 'ul(li(p(a), ol(li(p(b)))))'],
    // Selections across depths convert each block where it is.
    ['- a\n  - b', 'a..b', 'paragraph', 'p(a), p(b)'],
    ['- a\n  - b', 'a..b', 'blockquote', 'bq(p(a), p(b))'],
    ['- a\n  - b', 'a..b', 'ordered-list', 'ol(li(p(a), ol(li(p(b)))))'],
    [depth3, 'b..c', 'paragraph', 'ul(li(p(a), p(b), p(c)), li(p(d)))'],
    [
      depth3,
      'c..d',
      'blockquote',
      'ul(li(p(a), ul(li(p(b), bq(p(c)))))), bq(p(d))',
    ],
    ['- a\n  - b\n\n    c', 'b..c', 'heading-1', 'ul(li(p(a), h1(b), h1(c)))'],
    [
      depth3,
      '*',
      'ordered-list',
      'ol(li(p(a), ol(li(p(b), ol(li(p(c)))))), li(p(d)))',
    ],
    [depth3, '*', 'paragraph', 'p(a), p(b), p(c), p(d)'],
    [
      'x\n\n1. a\n\ny',
      'x..y',
      'bullet-list',
      'ul(li(p(x)), li(p(a)), li(p(y)))',
    ],
  ])('%j, %s → %s', (markdown, selection, format, expected) => {
    const editor = convert(markdown, selection, format);
    expect(outline(editor.state.doc)).toBe(expected);
    expect(reparsedOutline(editor)).toBe(expected);
  });

  it('keeps the language of code blocks that already are code blocks', () => {
    const editor = convert('```js\nx\n```\n\ny', 'x..y', 'code-block');
    expect(editor.state.doc.child(0).attrs.language).toBe('js');
    expect(editor.state.doc.child(1).type.name).toBe('codeBlock');
  });

  it('turns code newlines into hard breaks', () => {
    const editor = convert('```\nx\ny\n```', 'x\ny', 'paragraph');
    expect(editor.getJSON().content).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'x' },
          { type: 'hardBreak' },
          { type: 'text', text: 'y' },
        ],
      },
    ]);
  });

  it('cannot run when every block already has the format', () => {
    const editor = createEditor(depth3);
    editor.commands.selectAll();
    expect(editor.can().setBlockFormat('bullet-list')).toBe(false);
    expect(editor.can().setBlockFormat('paragraph')).toBe(true);
  });
});

describe('getBlockFormat', () => {
  it.each<[string, string, BlockFormat | null]>([
    [depth3, '*', 'bullet-list'],
    [depth3, 'c', 'bullet-list'],
    ['1. a\n   - b', 'a', 'ordered-list'],
    ['1. a\n   - b', 'a..b', null],
    ['- a\n\n  b', 'b', 'paragraph'],
    ['- a\n\n  ## b', 'b', 'heading-2'],
    ['> a', 'a', 'blockquote'],
    ['> ## a', 'a', 'heading-2'],
    ['- a\n\n  ```\n  b\n  ```', 'b', 'code-block'],
  ])('%j, %s → %s', (markdown, selection, expected) => {
    const editor = createEditor(markdown);
    const [first = '', last] = selection.split('..');
    select(editor, first, last);
    expect(getBlockFormat(editor.state)).toBe(expected);
  });
});

describe('toggleBlockFormat', () => {
  it('turns a block that has the format back into a paragraph in place', () => {
    const editor = createEditor(depth3);
    select(editor, 'c');
    editor.commands.toggleBlockFormat('heading-1');
    expect(outline(editor.state.doc)).toBe(
      'ul(li(p(a), ul(li(p(b), h1(c)))), li(p(d)))',
    );
    editor.commands.toggleBlockFormat('heading-1');
    expect(outline(editor.state.doc)).toBe(
      'ul(li(p(a), ul(li(p(b), p(c)))), li(p(d)))',
    );
  });
});

// Without a DOM there is no view to dispatch key events to, so this runs the
// handlers in the order TipTap's ExtensionManager stacks their keymaps.
function press(editor: Editor, key: string): void {
  const extensions = sortExtensions(
    [...editor.extensionManager.extensions].reverse(),
  );
  for (const extension of extensions) {
    const addKeyboardShortcuts = getExtensionField<
      () => Record<string, KeyboardShortcutCommand>
    >(extension, 'addKeyboardShortcuts', {
      name: extension.name,
      options: extension.options,
      storage: editor.extensionStorage[extension.name as keyof Storage],
      editor,
      type: getSchemaTypeByName(extension.name, editor.schema),
    });
    if (addKeyboardShortcuts?.()[key]?.({ editor })) {
      return;
    }
  }
}

describe('keyboard shortcuts', () => {
  it.each<[string, string, string]>([
    ['Mod-Alt-1', 'c', 'ul(li(p(a), ul(li(p(b), h1(c)))), li(p(d)))'],
    ['Mod-Alt-0', 'c', 'ul(li(p(a), ul(li(p(b), p(c)))), li(p(d)))'],
    ['Mod-Alt-c', 'c', 'ul(li(p(a), ul(li(p(b), code(c)))), li(p(d)))'],
    ['Mod-Shift-8', 'c', 'ul(li(p(a), ul(li(p(b), p(c)))), li(p(d)))'],
    ['Mod-Shift-7', 'c', 'ul(li(p(a), ul(li(p(b), ol(li(p(c)))))), li(p(d)))'],
  ])('%s keeps the nesting', (key, text, expected) => {
    const editor = createEditor(depth3);
    editor.commands.setTextSelection(textPosition(editor, text));
    press(editor, key);
    expect(outline(editor.state.doc)).toBe(expected);
  });

  it('joins a later block of a list item into the one before on Backspace', () => {
    const editor = createEditor('- x\n- a\n\n  ## b');
    editor.commands.setTextSelection(textPosition(editor, 'b'));
    press(editor, 'Backspace');
    expect(outline(editor.state.doc)).toBe('ul(li(p(x)), li(p(ab)))');
  });

  it('turns an empty code block in a list item into a paragraph on Backspace', () => {
    const editor = createEditor('- a\n  - b');
    select(editor, 'b');
    editor.commands.deleteSelection();
    editor.commands.setBlockFormat('code-block');
    press(editor, 'Backspace');
    expect(outline(editor.state.doc)).toBe('ul(li(p(a), p()))');
  });
});
