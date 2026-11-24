import { Editor } from '@tiptap/core';
import { expect, it } from 'vitest';

import { PubExtensions } from '../index';
import {
  type FuzzStatistics,
  fuzzMarkdownEdits,
} from '../testing/markdown-properties';

const createEditor = () =>
  new Editor({
    element: null,
    extensions: [PubExtensions.configure({})],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  });

it.each([
  20261125, 1, 2, 3, 4,
])('saves random edits as what they mean, without giving up the baseline (seed %i)', {
  timeout: 240_000,
}, (seed) => {
  const statistics: FuzzStatistics = {
    strategies: new Map(),
    collateral: 0,
    saves: 0,
  };
  const violations = fuzzMarkdownEdits(createEditor, {
    seed,
    documents: 200,
    edits: 8,
    statistics,
  });
  // A bare URL right before other syntax, which GFM reads into the URL
  // whatever is escaped, cannot always be written: the save is refused.
  const refused = violations.filter((it) => it.property === 'error');
  expect(violations.filter((it) => it.property !== 'error')).toEqual([]);
  expect(refused.length).toBeLessThan(statistics.saves / 200);
  expect(statistics.strategies.get('generated') ?? 0).toBe(0);
});
