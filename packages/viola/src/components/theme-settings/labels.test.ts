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
  it('drops the subgroup prefix', () => {
    expect(
      getVariableLabel({ key: 'color-foreground', subgroup: 'color' }),
    ).toBe('Foreground');
    expect(
      getVariableLabel({
        key: 'mbox-top-left-content',
        subgroup: 'mbox-top-left',
      }),
    ).toBe('Content');
  });

  it('keeps the whole key without a subgroup or a matching prefix', () => {
    expect(getVariableLabel({ key: 'font-size', subgroup: null })).toBe(
      'Font size',
    );
    expect(getVariableLabel({ key: 'call', subgroup: 'call' })).toBe('Call');
  });
});
