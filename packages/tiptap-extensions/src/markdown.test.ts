import { Editor, type JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';

import { getMarkdown, PubExtensions } from './index';

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
  editor.commands.setMarkdown(markdown);
  return getMarkdown(editor, { baseline: '' });
}

function serialize(inline: JSONContent[]): string {
  const editor = createEditor();
  editor.commands.setContent({
    type: 'doc',
    content: [{ type: 'paragraph', content: inline }],
  });
  return getMarkdown(editor);
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
  editor.commands.setMarkdown(markdown);
  return editor.getJSON().content ?? [];
}

function serializeBlock(block: JSONContent): string {
  const editor = createEditor();
  editor.commands.setContent({ type: 'doc', content: [block] });
  return getMarkdown(editor);
}

const fenced = (info: string, fence = '```') =>
  `${fence}${info}\nconst a = 1;\n${fence}`;

describe('code block info string', () => {
  it.each([
    ['no info string', ''],
    ['a language', 'js'],
    ['a language and meta', 'js title=example.js'],
    ['a VFM title', 'js:example.js'],
    ['a VFM title and meta', 'js:a.js {.lines}'],
    ['quoted meta', 'js title="a b" x=1'],
    ['an attribute block', 'js {#id .c title="{a}"}'],
    ['escapes', 'js title=a\\_b\\\\'],
    ['runs of spaces and tabs', 'js  \ttitle=x'],
    ['spaces around it', ' js title=x  '],
    ['only spaces', '   '],
    ['wide spaces', 'js　x y'],
  ])('keeps %s as written', (_, info) => {
    const markdown = fenced(info);
    expect(parse(markdown)[0]?.attrs).toEqual({ language: info || null });
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('keeps backticks in a tilde fence', () => {
    const markdown = fenced('js title=`a`', '~~~');
    expect(parse(markdown)[0]?.attrs).toEqual({ language: 'js title=`a`' });
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

  it('reads a fence indented by up to three spaces', () => {
    expect(roundTrip('   ```js title=x\n   a\n    b\n   ```')).toBe(
      '```js title=x\na\n b\n```',
    );
  });

  it('makes the fence longer than any fence inside the code', () => {
    expect(roundTrip('~~~\n```\n~~~')).toBe('````\n```\n````');
    expect(roundTrip('`````md\n````js\n````\n`````')).toBe(
      '`````md\n````js\n````\n`````',
    );
    expect(roundTrip('~~~~a`b\n ~~~\n~~~~')).toBe('~~~~a`b\n ~~~\n~~~~');
  });

  // Saving reads the output back, which for this many fence-like lines
  // takes seconds on a slow runner.
  it('measures fences in code too long to spread into a call', {
    timeout: 60_000,
  }, () => {
    const code = Array.from({ length: 200_000 }, () => '```').join('\n');
    expect(
      serializeBlock({
        type: 'codeBlock',
        attrs: { language: null },
        content: [{ type: 'text', text: code }],
      }),
    ).toBe(`\`\`\`\`\n${code}\n\`\`\`\``);
  });

  it('switches to tildes for an info string with backticks', () => {
    expect(
      serializeBlock({
        type: 'codeBlock',
        attrs: { language: 'js title=`a`' },
        content: [{ type: 'text', text: 'const a = 1;' }],
      }),
    ).toBe(fenced('js title=`a`', '~~~'));
  });

  it('keeps leading tildes out of a tilde fence', () => {
    const markdown = serializeBlock({
      type: 'codeBlock',
      attrs: { language: '~`' },
      content: [{ type: 'text', text: 'const a = 1;' }],
    });
    expect(markdown).toBe(fenced(' ~`', '~~~'));
    expect(parse(markdown)[0]?.attrs).toEqual({ language: ' ~`' });
  });
});
