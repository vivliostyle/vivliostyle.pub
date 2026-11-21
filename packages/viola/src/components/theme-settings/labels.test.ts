import { describe, expect, it } from 'vitest';

import { getVariableLabel, humanizeKey } from './labels';

describe('humanizeKey', () => {
  it.each([
    ['font-size', 'Font size'],
    ['h1-margin-block', 'H1 margin block'],
    ['mbox-top-left-corner', 'Margin box top left corner'],
    ['toc', 'TOC'],
    ['ol-list-style-type', 'OL list style type'],
    ['', ''],
  ])('%s → %s', (key, label) => {
    expect(humanizeKey(key)).toBe(label);
  });
});

describe('getVariableLabel', () => {
  it('drops the target of its section', () => {
    expect(
      getVariableLabel({
        key: 'mbox-top-left-content',
        subgroup: { kind: 'target', id: 'mbox-top-left' },
      }),
    ).toBe('Content');
    expect(
      getVariableLabel({
        key: 'table-row-even-background-color',
        subgroup: { kind: 'target', id: 'table' },
      }),
    ).toBe('Row even background color');
  });

  it('keeps the whole key in a category or without a matching prefix', () => {
    expect(
      getVariableLabel({
        key: 'color-foreground',
        subgroup: { kind: 'category', id: 'color' },
      }),
    ).toBe('Color foreground');
    expect(
      getVariableLabel({
        key: 'call',
        subgroup: { kind: 'target', id: 'call' },
      }),
    ).toBe('Call');
  });
});
