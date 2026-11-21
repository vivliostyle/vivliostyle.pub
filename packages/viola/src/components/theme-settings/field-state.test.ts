import { describe, expect, it } from 'vitest';

import {
  describeVariable,
  getDescriptorUnits,
  loadThemeVariableSchema,
  parseSyntax,
  validateValue,
} from '../../libs/theme-variables';
import { completeUnits, getDefaultUnit } from './field-state';

const margin = parseSyntax('auto | <length-percentage>+');
const length = parseSyntax('thin | <length>');
const stretch = parseSyntax('normal | <percentage>');
const lineHeight = parseSyntax('normal | <length> | <number> | <percentage>');
const weight = parseSyntax('bold | <number>');
const units = getDescriptorUnits(margin);

describe('getDefaultUnit', () => {
  it('takes the unit in use, then the one of the default', () => {
    expect(getDefaultUnit(units, ['10PT', '2em'])).toBe('pt');
    expect(getDefaultUnit(units, ['', '2em'])).toBe('em');
    expect(getDefaultUnit(units, [undefined, '0 5%'])).toBe('%');
  });

  it('ignores units the value cannot take and nested ones', () => {
    expect(getDefaultUnit(units, ['3deg', 'calc(1em + 2pt)'])).toBe('mm');
    expect(getDefaultUnit(units, ['var(--x, 1em)', undefined])).toBe('mm');
  });

  it('falls back to the first unit, never to unitless', () => {
    expect(getDefaultUnit(getDescriptorUnits(lineHeight), [])).toBe('mm');
    expect(getDefaultUnit(getDescriptorUnits(stretch), ['normal'])).toBe('%');
    expect(getDefaultUnit(getDescriptorUnits(weight), ['700'])).toBe('');
    expect(getDefaultUnit([], ['auto'])).toBe('');
  });
});

describe('completeUnits', () => {
  it.each([
    ['12', margin, 'mm', '12mm'],
    [' 12 ', margin, 'mm', ' 12mm '],
    ['-1.5', margin, 'pt', '-1.5pt'],
    ['10 20', margin, 'mm', '10mm 20mm'],
    ['10 20pt', margin, 'mm', '10mm 20pt'],
    ['1e2', length, 'px', '1e2px'],
    // Unlike a length, a percentage has no unitless zero.
    ['0', stretch, '%', '0%'],
  ])('%j → %j', (text, descriptor, unit, expected) => {
    expect(completeUnits(text, descriptor, unit)).toBe(expected);
  });

  it.each([
    ['0', margin],
    ['0 auto', margin],
    ['12px', margin],
    ['auto', margin],
    ['1.5', lineHeight],
    ['700', weight],
    ['calc(2 * 3em)', margin],
    ['var(--x, 2)', margin],
    ['1.', margin],
    ['1+2', margin],
    ['12', parseSyntax('<integer>')],
    ['12', parseSyntax('<custom-ident>')],
  ])('leaves %j alone', (text, descriptor) => {
    expect(completeUnits(text, descriptor, 'mm')).toBe(text);
  });

  it('completes a bare number for a universal descriptor too', () => {
    const descriptor = describeVariable({
      syntax: '*',
      properties: ['margin-block'],
      key: 'margin-block',
    });
    expect(descriptor.universal).toBe(true);
    expect(validateValue(descriptor, '12').valid).toBe(true);
    expect(completeUnits('12', descriptor, 'em')).toBe('12em');
  });

  it('does nothing without a unit to give', () => {
    expect(completeUnits('12', margin, '')).toBe('12');
  });

  it('leaves every schema default as it is', async () => {
    const schema = await loadThemeVariableSchema();
    let checked = 0;
    for (const variable of schema.variables) {
      const descriptor = describeVariable(variable);
      const { defaultValue } = variable;
      if (!defaultValue) {
        continue;
      }
      const unit = getDefaultUnit(getDescriptorUnits(descriptor), [
        defaultValue,
      ]);
      expect([
        variable.name,
        completeUnits(defaultValue, descriptor, unit),
      ]).toEqual([variable.name, defaultValue]);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });
});
