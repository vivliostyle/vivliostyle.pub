import { Editor } from '@tiptap/core';
import { afterAll, describe, expect, it } from 'vitest';

import { PubExtensions } from '../index';
import { judgeReadBack } from './read-back-judge';

const editor = new Editor({
  element: null,
  extensions: [PubExtensions.configure({})],
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
});

afterAll(() => {
  editor.destroy();
});

const { schema } = editor;

function paragraphs(...contents: Parameters<typeof schema.text>[][]) {
  return schema.topNodeType.create(
    null,
    contents.map((content) =>
      schema.nodes.paragraph.create(
        null,
        content.map(([text, marks]) => schema.text(text, marks)),
      ),
    ),
  );
}

describe('judging read-back', () => {
  it('takes every emphasis off whitespace at the edges of their ranges', () => {
    const bold = schema.marks.bold.create();
    const italic = schema.marks.italic.create();
    const expected = paragraphs([
      ['a', [bold]],
      [' ', [bold, italic]],
      ['b', [italic]],
    ]);
    const actual = paragraphs([['a', [bold]], [' '], ['b', [italic]]]);
    expect(judgeReadBack(expected, actual).unexplained).toEqual([]);
  });
});
