import { Editor } from '@tiptap/core';
import { expect, it } from 'vitest';

import { PubExtensions } from '../index';
import { fuzzMarkdownEdits } from '../testing/markdown-properties';

const createEditor = () =>
  new Editor({
    element: null,
    extensions: [PubExtensions.configure({})],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  });

it('saves random edits as what they mean, without giving up the baseline', {
  timeout: 120_000,
}, () => {
  const violations = fuzzMarkdownEdits(createEditor, {
    seed: 20261125,
    documents: 400,
    edits: 6,
  });
  expect(violations).toEqual([]);
});
