import { Editor } from '@tiptap/core';
import { expect, it } from 'vitest';

import { PubExtensions } from '../index';
import {
  type FuzzStatistics,
  fuzzMarkdownEdits,
  THEME_FRAGMENTS,
  THEME_INSERTS,
  VFM_FRAGMENTS,
  VFM_INSERTS,
} from '../testing/markdown-properties';

// With the plugins, which keep nodes in a state their markdown can hold, as
// in the app; a headless editor's state has none.
const createEditor = () => {
  const editor = new Editor({
    element: null,
    extensions: [PubExtensions.configure({})],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  });
  editor.view.updateState(
    editor.state.reconfigure({ plugins: editor.extensionManager.plugins }),
  );
  return editor;
};

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
  expect(violations).toEqual([]);
  expect(statistics.strategies.get('generated') ?? 0).toBe(0);
});

it.each([
  20261125, 5, 6,
])('saves random edits of VFM syntax as what they mean (seed %i)', {
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
    fragments: VFM_FRAGMENTS,
    inserts: VFM_INSERTS,
  });
  // Random marks make states no markdown holds, and the save is refused:
  // code holding `|` in a ruby's base, which only its HTML element could
  // hold, and emphasis that overlaps strikethrough at whitespace.
  const refused = violations.filter((it) => it.property === 'error');
  expect(violations.filter((it) => it.property !== 'error')).toEqual([]);
  expect(refused.length).toBeLessThan(statistics.saves / 200);
  expect(statistics.strategies.get('generated') ?? 0).toBe(0);
});

it.each([
  20261125, 7, 8,
])('saves random edits of the markup of themes as what they mean (seed %i)', {
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
    fragments: THEME_FRAGMENTS,
    inserts: THEME_INSERTS,
  });
  expect(violations).toEqual([]);
  expect(statistics.strategies.get('generated') ?? 0).toBe(0);
});
