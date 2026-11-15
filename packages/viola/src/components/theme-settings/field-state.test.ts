import { describe, expect, it } from 'vitest';

import {
  describeVariable,
  getDescriptorUnits,
  loadThemeVariableSchema,
  parseSyntax,
  type ValueDescriptor,
} from '../../libs/theme-variables';
import {
  composeDimension,
  decodeOption,
  encodeOption,
  type FieldOption,
  getDefaultUnit,
  getSelectedOption,
  parseFieldValue,
  planNumberCommit,
  planUnitChange,
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
    ['1.50em', margin, { kind: 'dimension', number: '1.50', unit: 'em' }],
    ['.5em', margin, { kind: 'dimension', number: '.5', unit: 'em' }],
    ['+1e2pt', margin, { kind: 'dimension', number: '+1e2', unit: 'pt' }],
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
    [' .5 ', 'em', '.5em'],
    ['1.50', 'em', '1.50em'],
    ['0.0000001', 'mm', '0.0000001mm'],
    ['1e2', 'px', '1e2px'],
    ['-1', '', '-1'],
    ['', 'mm', ''],
  ])('%j + %j → %j', (number, unit, value) => {
    expect(composeDimension(number, unit)).toBe(value);
  });

  it.each([
    'abc',
    'auto',
    '1e',
    '-',
    '.',
    '1.2.3',
    '12mm',
  ])('refuses %j', (number) => {
    expect(composeDimension(number, 'mm')).toBeNull();
  });
});

const shapeOf = (descriptor: ValueDescriptor) => ({
  keywords: descriptor.keywords,
  units: getDescriptorUnits(descriptor),
});

/** The number input as it first renders `value`, left as is on blur. */
function blurUntouched(
  value: string,
  descriptor: ValueDescriptor,
  defaultValue?: string,
) {
  const shape = shapeOf(descriptor);
  const view = resolveFieldView(
    value,
    null,
    shape,
    getDefaultUnit(shape, defaultValue),
  );
  if (view.kind !== 'dimension') {
    return null;
  }
  return planNumberCommit({
    draft: view.number,
    displayed: view.number,
    unit: view.unit,
    value,
  });
}

describe('planNumberCommit', () => {
  const length = parseSyntax('thin | <length>');
  const lengthPercentage = parseSyntax('auto | <length-percentage>');
  const number = parseSyntax('bold | <number>');

  it.each([
    ['0', length],
    ['0', lengthPercentage],
    ['1.50em', lengthPercentage],
    ['.5em', lengthPercentage],
    ['10PX', length],
    ['+1em', length],
    ['1e2px', length],
    ['0.0000001mm', length],
    ['-3pt', length],
    ['100%', lengthPercentage],
    ['1.50', number],
    ['', length],
  ])('commits nothing for an untouched %j', (value, descriptor) => {
    expect(blurUntouched(value, descriptor)).toEqual({ kind: 'none' });
  });

  it('commits nothing for an untouched schema default', async () => {
    const schema = await loadThemeVariableSchema();
    let checked = 0;
    for (const variable of schema.variables) {
      const descriptor = describeVariable(variable);
      if (
        !variable.defaultValue ||
        !['select', 'dimension', 'number'].includes(descriptor.input)
      ) {
        continue;
      }
      const plan = blurUntouched(
        variable.defaultValue,
        descriptor,
        variable.defaultValue,
      );
      if (plan) {
        expect([variable.name, plan]).toEqual([
          variable.name,
          { kind: 'none' },
        ]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(40);
  });

  it('commits an edited number with the displayed unit', () => {
    expect(
      planNumberCommit({ draft: '12', displayed: '0', unit: 'mm', value: '0' }),
    ).toEqual({ kind: 'commit', value: '12mm' });
  });

  it('unsets a cleared number', () => {
    expect(
      planNumberCommit({
        draft: ' ',
        displayed: '12',
        unit: 'mm',
        value: '12mm',
      }),
    ).toEqual({ kind: 'commit', value: '' });
  });

  it('keeps a keyword when the pending number stays empty', () => {
    expect(
      planNumberCommit({ draft: '', displayed: '', unit: 'mm', value: 'auto' }),
    ).toEqual({ kind: 'none' });
  });

  it.each(['auto', '1e', '-'])('rejects %j instead of unsetting', (draft) => {
    expect(
      planNumberCommit({ draft, displayed: '12', unit: 'mm', value: '12mm' }),
    ).toEqual({ kind: 'error', error: 'not-a-number' });
  });
});

describe('planUnitChange', () => {
  it('keeps the number as written', () => {
    expect(planUnitChange({ draft: '.5', unit: 'pt', value: '.5em' })).toEqual({
      kind: 'commit',
      value: '.5pt',
    });
  });

  it('gives a unitless zero the picked unit', () => {
    expect(planUnitChange({ draft: '0', unit: 'pt', value: '0' })).toEqual({
      kind: 'commit',
      value: '0pt',
    });
  });

  it('waits for a number', () => {
    expect(planUnitChange({ draft: '', unit: 'pt', value: 'auto' })).toEqual({
      kind: 'none',
    });
  });
});
