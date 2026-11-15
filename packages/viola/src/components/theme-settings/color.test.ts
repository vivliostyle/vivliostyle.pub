import { describe, expect, it } from 'vitest';

import { parseHexColor, toPickerColor } from './color';

describe('parseHexColor', () => {
  it.each([
    ['#ABC', '#aabbcc'],
    [' #112233 ', '#112233'],
    ['#1234', null],
    ['#11223344', null],
    ['red', null],
    ['var(--x)', null],
  ])('%j → %j', (value, hex) => {
    expect(parseHexColor(value)).toBe(hex);
  });
});

describe('toPickerColor', () => {
  it('needs no canvas for hex colors', () => {
    expect(toPickerColor('#fff')).toBe('#ffffff');
  });

  it('gives up without a DOM', () => {
    expect(toPickerColor('red')).toBeNull();
  });
});
