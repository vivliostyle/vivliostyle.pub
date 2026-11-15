import { describe, expect, it } from 'vitest';

import {
  composeDimension,
  decodeOption,
  encodeOption,
  type FieldOption,
  getDefaultUnit,
  getSelectedOption,
  parseFieldValue,
  resolveFieldView,
} from './field-state';

const margin = { keywords: ['auto'], units: ['mm', 'pt', 'em', '%'] };
const weight = { keywords: ['bold', 'normal'], units: [''] };
const fill = { keywords: ['auto', 'balance'], units: [] };

describe('parseFieldValue', () => {
  it.each([
    ['', margin, { kind: 'empty' }],
    ['  ', margin, { kind: 'empty' }],
    ['AUTO', margin, { kind: 'keyword', keyword: 'auto' }],
    ['12.5mm', margin, { kind: 'dimension', number: '12.5', unit: 'mm' }],
    ['3PT', margin, { kind: 'dimension', number: '3', unit: 'pt' }],
    ['0', margin, { kind: 'dimension', number: '0', unit: 'mm' }],
    ['5', margin, { kind: 'custom' }],
    ['12px', margin, { kind: 'custom' }],
    ['1em 2em', margin, { kind: 'custom' }],
    ['var(--x)', margin, { kind: 'custom' }],
    ['700', weight, { kind: 'dimension', number: '700', unit: '' }],
    ['bold', weight, { kind: 'keyword', keyword: 'bold' }],
    ['balance', fill, { kind: 'keyword', keyword: 'balance' }],
    ['1', fill, { kind: 'custom' }],
  ])('%j', (value, shape, view) => {
    expect(parseFieldValue(value, shape)).toEqual(view);
  });
});

describe('getDefaultUnit', () => {
  it('takes the unit of the default value', () => {
    expect(getDefaultUnit(margin, '2em')).toBe('em');
  });

  it('falls back to the first unit', () => {
    expect(getDefaultUnit(margin, 'var(--x)')).toBe('mm');
    expect(getDefaultUnit(margin, undefined)).toBe('mm');
    expect(getDefaultUnit(fill, 'auto')).toBe('');
  });
});

describe('resolveFieldView', () => {
  it('offers the number input for an unset dimension', () => {
    expect(resolveFieldView('', null, margin, 'pt')).toEqual({
      kind: 'dimension',
      number: '',
      unit: 'pt',
    });
    expect(resolveFieldView('', null, fill, '')).toEqual({ kind: 'empty' });
  });

  it('shows a pending unit until a number is entered', () => {
    expect(
      resolveFieldView('auto', { kind: 'dimension', unit: 'em' }, margin, 'mm'),
    ).toEqual({ kind: 'dimension', number: '', unit: 'em' });
    expect(
      resolveFieldView(
        'var(--x)',
        { kind: 'dimension', unit: 'em' },
        margin,
        'mm',
      ),
    ).toEqual({ kind: 'dimension', number: '', unit: 'em' });
  });

  it('lets the committed dimension win over a pending unit', () => {
    expect(
      resolveFieldView('3pt', { kind: 'dimension', unit: 'em' }, margin, 'mm'),
    ).toEqual({ kind: 'dimension', number: '3', unit: 'pt' });
  });

  it('keeps free text once chosen, whatever the value', () => {
    expect(resolveFieldView('3pt', { kind: 'custom' }, margin, 'mm')).toEqual({
      kind: 'custom',
    });
  });
});

describe('options', () => {
  it.each<FieldOption>([
    { kind: 'default' },
    { kind: 'custom' },
    { kind: 'unit', unit: '' },
    { kind: 'unit', unit: '%' },
    { kind: 'keyword', keyword: 'auto' },
  ])('round-trips %j', (option) => {
    expect(decodeOption(encodeOption(option))).toEqual(option);
  });

  it('selects the option of a view', () => {
    expect(
      getSelectedOption({ kind: 'dimension', number: '1', unit: 'mm' }),
    ).toEqual({ kind: 'unit', unit: 'mm' });
    expect(getSelectedOption({ kind: 'empty' })).toEqual({ kind: 'default' });
  });
});

describe('composeDimension', () => {
  it.each([
    ['12', 'mm', '12mm'],
    [' 0.30000000000000004 ', 'em', '0.3em'],
    ['-1', '', '-1'],
    ['', 'mm', ''],
    ['abc', 'mm', 'abcmm'],
  ])('%j + %j → %j', (number, unit, value) => {
    expect(composeDimension(number, unit)).toBe(value);
  });
});
