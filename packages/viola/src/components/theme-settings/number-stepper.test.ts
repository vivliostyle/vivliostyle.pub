import { describe, expect, it } from 'vitest';

import {
  addToNumber,
  findNumericTokens,
  getNumberRange,
  getStepDelta,
  type StepKey,
  stepFirstNumber,
  stepNumber,
  stepNumberAt,
} from './number-stepper';

const numbers = (text: string) =>
  findNumericTokens(text).map(({ number, unit, depth }) => [
    number,
    unit,
    depth,
  ]);

describe('findNumericTokens', () => {
  it.each<[string, (string | number)[][]]>([
    ['10mm', [['10', 'mm', 0]]],
    [
      '10mm 20MM',
      [
        ['10', 'mm', 0],
        ['20', 'MM', 0],
      ],
    ],
    ['-1.5e2px', [['-1.5e2', 'px', 0]]],
    ['+.5em', [['+.5', 'em', 0]]],
    ['.5em', [['.5', 'em', 0]]],
    ['120%', [['120', '%', 0]]],
    ['1e3', [['1e3', '', 0]]],
    ['1em', [['1', 'em', 0]]],
    ['1e-x', [['1', 'e-x', 0]]],
    ['1.', [['1', '', 0]]],
    [
      'calc(1em + 2pt)',
      [
        ['1', 'em', 1],
        ['2', 'pt', 1],
      ],
    ],
    [
      'calc(1em - -2pt)',
      [
        ['1', 'em', 1],
        ['-2', 'pt', 1],
      ],
    ],
    [
      'rgb(10 20 30 / 50%)',
      [
        ['10', '', 1],
        ['20', '', 1],
        ['30', '', 1],
        ['50', '%', 1],
      ],
    ],
    [
      'var(--vs-x2, 3mm) 4mm',
      [
        ['3', 'mm', 1],
        ['4', 'mm', 0],
      ],
    ],
    // As in CSS, a unit runs on through `-` and digits.
    ['10mm-5mm', [['10', 'mm-5mm', 0]]],
    ['h1 2', [['2', '', 0]]],
  ])('%j', (text, expected) => {
    expect(numbers(text)).toEqual(expected);
  });

  it.each([
    'auto',
    '#fff000',
    '#1e2',
    'h1',
    'x2y',
    '-x2',
    '--vs-x2',
    'var(--vs-x2)',
    '"10px"',
    "'a\\'1'",
    '/* 10px */',
    'url(img10.png)',
    'url( a(1).png )',
    'counter(h2, decimal)',
  ])('finds no number in %j', (text) => {
    expect(numbers(text)).toEqual([]);
  });

  it('reads past quoted URLs and comments', () => {
    expect(numbers('url("a1.png") /* 2 */ 3px')).toEqual([['3', 'px', 0]]);
  });

  it('records offsets of number and unit', () => {
    expect(findNumericTokens('a 10mm')).toEqual([
      { start: 2, end: 4, unitEnd: 6, depth: 0, number: '10', unit: 'mm' },
    ]);
  });
});

describe('addToNumber', () => {
  it.each([
    ['1', 1, '2'],
    ['1', -2, '-1'],
    ['-1', 1, '0'],
    ['-0.1', 0.1, '0'],
    ['1.5', 0.1, '1.6'],
    ['0.2', 0.1, '0.3'],
    ['0.7', 0.1, '0.8'],
    ['1.1', -0.1, '1'],
    ['1', 0.1, '1.1'],
    ['1', 0.01, '1.01'],
    ['1.50', 1, '2.5'],
    ['.5', 0.1, '0.6'],
    ['+3', 10, '13'],
    ['1e2', 1, '101'],
    ['1.5e-3', 0.1, '0.1015'],
    ['0.0000001', 1, '1.0000001'],
    ['9.99', 0.01, '10'],
  ])('%j + %j → %j', (number, delta, expected) => {
    expect(addToNumber(number, delta)).toBe(expected);
  });

  it('gives up on a number too large to be finite', () => {
    expect(addToNumber('1e999', 1)).toBeNull();
  });
});

describe('stepNumberAt', () => {
  const step = (marked: string, delta = 1) => {
    // `[` and `]` mark the selection, `|` a caret.
    const caret = marked.indexOf('|');
    const text = marked.replace(/[[\]|]/g, '');
    const start = caret !== -1 ? caret : marked.indexOf('[');
    const end = caret !== -1 ? caret : marked.indexOf(']') - 1;
    const result = stepNumberAt(text, start, end, delta);
    return (
      result &&
      `${result.text.slice(0, result.start)}[${result.text.slice(
        result.start,
        result.end,
      )}]${result.text.slice(result.end)}`
    );
  };

  it.each([
    ['|10mm', '[11]mm'],
    ['1|0mm', '[11]mm'],
    ['10m|m', '[11]mm'],
    ['10mm|', '[11]mm'],
    ['10mm| 20mm', '[11]mm 20mm'],
    ['10mm |20mm', '10mm [21]mm'],
    ['10mm 20mm|', '10mm [21]mm'],
    ['10mm [20]mm', '10mm [21]mm'],
    ['[10mm 20mm]', '[11]mm 20mm'],
    ['1,|2', '1,[3]'],
    ['calc(1em + 2p|t)', 'calc(1em + [3]pt)'],
    ['rgb(10 2|0 30)', 'rgb(10 [21] 30)'],
    ['var(--vs-x2, 3m|m)', 'var(--vs-x2, [4]mm)'],
    ['|-1mm', '[0]mm'],
    ['9|px', '[10]px'],
  ])('%j → %j', (marked, expected) => {
    expect(step(marked)).toBe(expected);
  });

  it('keeps untouched text as written', () => {
    expect(step('  1.50EM   20MM /* x */ |3', 10)).toBe(
      '  1.50EM   20MM /* x */ [13]',
    );
  });

  it.each([
    ['.|5em', 0.1, '[0.6]em'],
    ['1.|5em', 0.1, '[1.6]em'],
    ['0|mm', -1, '[-1]mm'],
    ['1|mm', -2, '[-1]mm'],
    ['1|00%', 10, '[110]%'],
  ])('%j by %j → %j', (marked, delta, expected) => {
    expect(step(marked, delta)).toBe(expected);
  });

  it.each([
    'au|to',
    '#fff|000',
    '#|1e2',
    'h|1',
    'var(--vs-x|2)',
    '"1|0px"',
    '/* 1|0px */',
    '10mm /* x */|',
    '|',
    'auto |',
  ])('leaves %j to the browser', (marked) => {
    expect(step(marked)).toBeNull();
  });

  it('keeps working on the same number across steps', () => {
    let result = stepNumberAt('9mm 9mm', 4, 4, 1);
    expect(result).toEqual({ text: '9mm 10mm', index: 1, start: 4, end: 6 });
    result = result && stepNumberAt(result.text, result.start, result.end, 1);
    expect(result).toEqual({ text: '9mm 11mm', index: 1, start: 4, end: 6 });
    result = result && stepNumberAt(result.text, result.start, result.end, -2);
    expect(result).toEqual({ text: '9mm 9mm', index: 1, start: 4, end: 5 });
  });
});

describe('stepNumber', () => {
  it('steps the number at an index', () => {
    expect(stepNumber('1em 2em', 1, 0.1)).toEqual({
      text: '1em 2.1em',
      index: 1,
      start: 4,
      end: 7,
    });
    expect(stepNumber('1em', 1, 1)).toBeNull();
  });
});

describe('stepFirstNumber', () => {
  it('steps the first top-level number', () => {
    expect(stepFirstNumber('0.8em', 1)?.text).toBe('1.8em');
    expect(stepFirstNumber('calc(1em + 2pt) 3pt', 1)).toEqual({
      text: 'calc(1em + 2pt) 4pt',
      index: 2,
      start: 16,
      end: 17,
    });
  });

  it('finds nothing to step in a reference or a keyword', () => {
    expect(stepFirstNumber('var(--vs-x, 1em)', 1)).toBeNull();
    expect(stepFirstNumber('auto', 1)).toBeNull();
  });
});

describe('getNumberRange', () => {
  it('finds the number of a token by index', () => {
    expect(getNumberRange('10mm 20mm', 1)).toEqual({ start: 5, end: 7 });
    expect(getNumberRange('10mm', 1)).toBeNull();
  });
});

describe('getStepDelta', () => {
  const key = (init: Partial<StepKey> & Pick<StepKey, 'key'>): StepKey => ({
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...init,
  });

  it.each([
    [key({ key: 'ArrowUp' }), 1],
    [key({ key: 'ArrowDown' }), -1],
    [key({ key: 'ArrowUp', shiftKey: true }), 10],
    [key({ key: 'ArrowDown', altKey: true }), -0.1],
    [key({ key: 'ArrowUp', shiftKey: true, altKey: true }), 0.01],
    [key({ key: 'ArrowUp', metaKey: true }), null],
    [key({ key: 'ArrowDown', ctrlKey: true }), null],
    [key({ key: 'ArrowLeft' }), null],
    [key({ key: 'PageUp' }), null],
  ])('%j → %j', (event, delta) => {
    expect(getStepDelta(event)).toBe(delta);
  });
});
