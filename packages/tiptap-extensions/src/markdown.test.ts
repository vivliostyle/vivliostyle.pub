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

function roundTrip(markdown: string): string {
  const editor = createEditor();
  editor.commands.setContent(markdown, { contentType: 'markdown' });
  return editor.getMarkdown();
}

function serialize(inline: JSONContent[]): string {
  const editor = createEditor();
  editor.commands.setContent({
    type: 'doc',
    content: [{ type: 'paragraph', content: inline }],
  });
  return editor.getMarkdown();
}

const url = 'https://example.com';
const link = (text: string, href = text): JSONContent => ({
  type: 'text',
  text,
  marks: [{ type: 'link', attrs: { href } }],
});

describe('bare URL links', () => {
  it.each([
    ['see https://example.com now'],
    ['https://example.com'],
    ['a https://example.com/a. b'],
    ['[site](https://example.com)'],
  ])('keeps %s as written', (markdown) => {
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('writes a link whose text is its URL as a bare URL', () => {
    expect(roundTrip(`[${url}](${url})`)).toBe(url);
    expect(serialize([{ type: 'text', text: 'see ' }, link(url)])).toBe(
      `see ${url}`,
    );
  });

  it('keeps brackets where a bare URL would not autolink the same way', () => {
    expect(serialize([link(url), { type: 'text', text: 'を参照' }])).toBe(
      `[${url}](${url})を参照`,
    );
    expect(serialize([{ type: 'text', text: '詳細は' }, link(url)])).toBe(
      `詳細は[${url}](${url})`,
    );
    expect(serialize([link(`${url}/a.`)])).toBe(`[${url}/a.](${url}/a.)`);
    expect(serialize([link('./chapter.md')])).toBe(
      '[./chapter.md](./chapter.md)',
    );
  });
});
