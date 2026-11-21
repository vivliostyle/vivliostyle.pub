import { describe, expect, it } from 'vitest';

import { addPrerenderedView, showView } from './use-prerender';

describe('showView', () => {
  it('moves the shown view to the front', () => {
    expect(showView(['a', 'b', 'c'], 'c', 6)).toEqual(['c', 'a', 'b']);
  });

  it('adds a new view and drops the one used longest ago', () => {
    expect(showView(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
  });
});

describe('addPrerenderedView', () => {
  it('keeps the shown view first', () => {
    expect(addPrerenderedView(['a', 'b'], 'c', 6)).toEqual(['a', 'c', 'b']);
  });

  it('evicts an older view rather than the shown one', () => {
    expect(addPrerenderedView(['a', 'b', 'c'], 'd', 3)).toEqual([
      'a',
      'd',
      'b',
    ]);
  });

  it('leaves the views alone when the view is already kept', () => {
    const keys = ['a', 'b'];
    expect(addPrerenderedView(keys, 'b', 6)).toBe(keys);
  });
});
