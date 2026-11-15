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

function parse(markdown: string): JSONContent[] {
  const editor = createEditor();
  editor.commands.setContent(markdown, { contentType: 'markdown' });
  return editor.getJSON().content ?? [];
}

function serializeBlock(block: JSONContent): string {
  const editor = createEditor();
  editor.commands.setContent({ type: 'doc', content: [block] });
  return editor.getMarkdown();
}

const fenced = (info: string, fence = '```') =>
  `${fence}${info}\nconst a = 1;\n${fence}`;

describe('code block info string', () => {
  it.each([
    ['no language', fenced(''), null, null],
    ['a language', fenced('js'), 'js', null],
    [
      'a language and meta',
      fenced('js title=example.js'),
      'js',
      'title=example.js',
    ],
    ['a VFM title', fenced('js:example.js'), 'js:example.js', null],
    ['a VFM title and meta', fenced('js:a.js {.lines}'), 'js:a.js', '{.lines}'],
    ['quoted meta', fenced('js title="a b" x=1'), 'js', 'title="a b" x=1'],
    [
      'an attribute block',
      fenced('js {#id .c title="{a}"}'),
      'js',
      '{#id .c title="{a}"}',
    ],
    ['escapes', fenced('js title=a\\_b\\\\'), 'js', 'title=a\\_b\\\\'],
    ['backticks', fenced('js title=`a`', '~~~'), 'js', 'title=`a`'],
    ['wide spaces', fenced('js　x y'), 'js　x', 'y'],
  ])('keeps %s as written', (_, markdown, language, meta) => {
    expect(parse(markdown)[0]?.attrs).toEqual({ language, meta });
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it.each([
    [
      'in a list item',
      `- item\n\n  ${fenced('js title=x').replaceAll('\n', '\n  ')}`,
    ],
    ['in a quote', `> ${fenced('js title=x').replaceAll('\n', '\n> ')}`],
  ])('keeps a code block %s as written', (_, markdown) => {
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('writes a single space between the language and meta', () => {
    expect(roundTrip(fenced('js \t title=x  '))).toBe(fenced('js title=x'));
  });

  it('reads a fence indented by up to three spaces', () => {
    expect(roundTrip('   ```js title=x\n   a\n    b\n   ```')).toBe(
      '```js title=x\na\n b\n```',
    );
  });

  it('writes an info string stored whole in the language', () => {
    expect(
      serializeBlock({
        type: 'codeBlock',
        attrs: { language: 'js  title=x' },
        content: [{ type: 'text', text: 'const a = 1;' }],
      }),
    ).toBe(fenced('js  title=x'));
  });

  it('writes meta without a language after `text`', () => {
    expect(
      serializeBlock({
        type: 'codeBlock',
        attrs: { meta: 'title=x' },
        content: [{ type: 'text', text: 'const a = 1;' }],
      }),
    ).toBe(fenced('text title=x'));
  });

  it('makes the fence longer than any fence inside the code', () => {
    expect(roundTrip('~~~\n```\n~~~')).toBe('````\n```\n````');
    expect(roundTrip('`````md\n````js\n````\n`````')).toBe(
      '`````md\n````js\n````\n`````',
    );
    expect(roundTrip('~~~~a`b\n ~~~\n~~~~')).toBe('~~~~a`b\n ~~~\n~~~~');
  });
});
