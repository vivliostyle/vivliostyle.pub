import { Editor, type JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';

import { PubExtensions } from './index';

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function createEditor(): Editor {
  editor = new Editor({
    element: null,
    extensions: [PubExtensions.configure({})],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  });
  return editor;
}

function parse(markdown: string): JSONContent[] | undefined {
  const editor = createEditor();
  editor.commands.setContent(markdown, { contentType: 'markdown' });
  expect(() => editor.state.doc.check()).not.toThrow();
  return editor.getJSON().content;
}

function serialize(content: JSONContent[]): string {
  const editor = createEditor();
  editor.commands.setContent({ type: 'doc', content });
  return editor.getMarkdown();
}

function roundTrip(markdown: string): string {
  const editor = createEditor();
  editor.commands.setContent(markdown, { contentType: 'markdown' });
  return editor.getMarkdown();
}

const text = (value: string): JSONContent => ({ type: 'text', text: value });
const paragraph = (value?: string): JSONContent =>
  value ? { type: 'paragraph', content: [text(value)] } : { type: 'paragraph' };
const node =
  (type: string, attrs?: Record<string, unknown>) =>
  (...content: JSONContent[]): JSONContent => ({
    type,
    ...(attrs && { attrs }),
    content,
  });
const listItem = node('listItem');
const bulletList = node('bulletList');
const orderedList = node('orderedList');
const heading: JSONContent = {
  type: 'heading',
  attrs: { level: 2 },
  content: [text('b')],
};

describe('list markdown', () => {
  it.each([
    ['nested lists', '- a\n  - b\n    - c'],
    ['ordered list content', '1. a\n2. b\n   1. c\n      - d\n3. e'],
    ['wide ordered markers', '10. a\n11. b\n    - c'],
    ['code in an ordered item', '1. a\n\n   ```js\n   x\n     y\n   ```'],
    ['a paragraph in an ordered item', '1. a\n\n   b\n2. c'],
    ['a heading in an item', '- a\n\n  ## b'],
    ['a quote in an item', '- a\n\n  > b'],
    ['a divider in an item', '- a\n\n  ---'],
    ['a list after an item paragraph', '- a\n\n  b\n  - c'],
    ['a list in a quote in an item', '- a\n\n  > - b\n  >   - c'],
    ['lists in a quote', '> - a\n>   - b'],
    ['a nested list not starting at 1', '- a\n\n  3. b'],
    ['a hard break in a nested item', '- a\n  - b  \n    c'],
    ['an item without a paragraph', '-\n  > a'],
    ['empty items', '1. a\n2.\n3. c'],
  ])('keeps %s as written', (_, markdown) => {
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('indents item content by the width of the marker', () => {
    expect(
      serialize([
        orderedList(
          listItem(paragraph('a'), bulletList(listItem(paragraph('b')))),
        ),
      ]),
    ).toBe('1. a\n   - b');
  });

  it('separates blocks that cannot interrupt the item paragraph', () => {
    expect(serialize([bulletList(listItem(paragraph('a'), heading))])).toBe(
      '- a\n\n  ## b',
    );
    expect(
      serialize([
        bulletList(listItem(paragraph('a'), bulletList(listItem(paragraph())))),
      ]),
    ).toBe('- a\n\n  -');
    expect(
      serialize([
        bulletList(
          listItem(
            paragraph('a'),
            node('orderedList', { start: 3 })(listItem(paragraph('b'))),
          ),
        ),
      ]),
    ).toBe('- a\n\n  3. b');
  });

  it('parses ordered list content as CommonMark does', () => {
    expect(parse('1. a\n\n   ```\n   x\n     y\n   ```')).toMatchObject([
      orderedList(
        listItem(paragraph('a'), {
          type: 'codeBlock',
          content: [text('x\n  y')],
        }),
      ),
    ]);
    expect(parse('1. a\n- b')).toMatchObject([
      orderedList(listItem(paragraph('a'))),
      bulletList(listItem(paragraph('b'))),
    ]);
  });

  it('starts every item with a paragraph', () => {
    expect(parse('- ## b')).toMatchObject([
      bulletList(listItem(paragraph(), heading)),
    ]);
    expect(parse('1. a\n2.\n3. c')?.[0]?.content?.[1]).toMatchObject(
      listItem(paragraph()),
    );
  });
});
