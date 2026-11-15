import { describe, expect, it } from 'vitest';

import { loadThemeVariableSchema } from './schema';
import { describeVariable, parseSyntax } from './syntax';
import {
  getDescriptorUnits,
  getUnits,
  joinDimension,
  splitDimension,
  validateValue,
} from './validate';

const valid = { valid: true };
const invalid = (reason: string) => ({ valid: false, reason });

describe('validateValue', () => {
  it.each([
    ['<color>', 'red'],
    ['<color>', 'RebeccaPurple'],
    ['<color>', 'currentColor'],
    ['<color>', 'transparent'],
    ['<color>', 'CanvasText'],
    ['<color>', '#fff'],
    ['<color>', '#FFFA'],
    ['<color>', '#00ff00'],
    ['<color>', '#00ff0080'],
    ['<color>', 'rgb(0 0 0 / 50%)'],
    ['<color>', 'color-mix(in srgb, red, blue)'],
    ['<color>', 'var(--vs-color-foreground)'],
    ['<color>+', 'red #fff rgb(0, 0, 0)'],
    ['<length>', '12pt'],
    ['<length>', '-1.5EM'],
    ['<length>', '0'],
    ['<length>', '.5rem'],
    ['<length>', '1e2px'],
    ['<length>', '10Q'],
    ['<length>', '5cqw'],
    ['<length>', 'calc(1em + 2px)'],
    ['<length>', 'min(2ch, 5vw)'],
    ['<percentage>', '50%'],
    ['<length-percentage>', '100%'],
    ['<length-percentage>', '2mm'],
    ['<length-percentage>+', '1em 2em 3% 0'],
    ['<length-percentage>+', '1em / 2em'],
    ['<number>', '1.5'],
    ['<number>', '-0.5'],
    ['<integer>', '4'],
    ['<integer>', '+2'],
    ['<integer> | <length>', '2em'],
    ['<angle>', '10deg'],
    ['<angle>', '0.5turn'],
    ['italic | normal | oblique | <angle>', 'oblique 10deg'],
    ['all | digits | none | <integer>', 'digits 2'],
    ['normal | <length> | <number> | <percentage>', '1.5'],
    ['normal | <length> | <number> | <percentage>', 'NORMAL'],
    ['none | <custom-ident> | <string>', 'upper-roman'],
    ['none | <custom-ident> | <string>', '"→ "'],
    ['none | <custom-ident> | <string>', "symbols(cyclic '*')"],
    ['auto | manual | none', 'manual'],
    ['auto | manual | none', 'inherit'],
    ['auto | manual | none', 'Revert-Layer'],
    ['auto | manual | none', 'var(--x)'],
    ['auto | manual | none', '/* why */ auto'],
    ['<string>', "'a;b}c'"],
  ])('accepts %j ← %j', (syntax, value) => {
    expect(validateValue(parseSyntax(syntax), value)).toEqual(valid);
  });

  it.each([
    ['<color>', 'bleu', 'not-allowed'],
    ['<color>', '#12', 'not-allowed'],
    ['<color>', '#ggg', 'not-allowed'],
    ['<color>', '12px', 'not-allowed'],
    ['<length>', '12', 'missing-unit'],
    ['<length>', '12xyz', 'unknown-unit'],
    ['<length>', '12deg', 'unknown-unit'],
    ['<length>', '50%', 'unknown-unit'],
    ['<length>', 'auto', 'not-allowed'],
    ['<length>', 'rgb(0 0 0)', 'not-allowed'],
    ['<length>', '"12px"', 'not-allowed'],
    ['<percentage>', '0', 'missing-unit'],
    ['<length-percentage>+', '1em 2', 'missing-unit'],
    ['<number>', '1.5em', 'not-allowed'],
    ['<integer>', '1.5', 'not-allowed'],
    ['<integer> | <length>', '1.5', 'missing-unit'],
    ['<angle>', '10px', 'unknown-unit'],
    ['auto | manual | none', 'automatic', 'not-allowed'],
    ['auto | manual | none', '1', 'not-allowed'],
    ['<custom-ident>', '1abc', 'not-allowed'],
    ['<color>', '', 'empty'],
    ['<color>', '   ', 'empty'],
    ['<color>', '/* red */', 'empty'],
    ['<color>', 'red; color: blue', 'malformed'],
    ['<color>', 'red !important', 'malformed'],
    ['<color>', 'rgb(0 0 0', 'malformed'],
    ['<string>', '"open', 'malformed'],
    ['<length>', '1px }', 'malformed'],
  ])('rejects %j ← %j as %s', (syntax, value, reason) => {
    expect(validateValue(parseSyntax(syntax), value)).toEqual(invalid(reason));
  });

  it('only checks that a universal value is well-formed', () => {
    const descriptor = describeVariable({
      syntax: '*',
      key: 'x',
      properties: ['color'],
    });
    expect(validateValue(descriptor, 'definitely not a color 12')).toEqual(
      valid,
    );
    expect(validateValue(descriptor, 'a { b; c }')).toEqual(valid);
    expect(validateValue(descriptor, '')).toEqual(invalid('empty'));
    expect(validateValue(descriptor, 'a; b')).toEqual(invalid('malformed'));
    expect(validateValue(descriptor, 'a)')).toEqual(invalid('malformed'));
  });

  it('accepts every default of the theme', async () => {
    const { variables } = await loadThemeVariableSchema();
    let checked = 0;
    for (const variable of variables) {
      const descriptor = describeVariable(variable);
      const defaults = [
        ...(variable.defaultValue ? [variable.defaultValue] : []),
        ...variable.conditionalDefaults.map((d) => d.value),
      ];
      for (const value of defaults) {
        expect(validateValue(descriptor, value), variable.name).toEqual(valid);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(250);
  });
});

describe('units', () => {
  it('lists the units of a type', () => {
    expect(getUnits('length')).toContain('mm');
    expect(getUnits('length')).not.toContain('%');
    expect(getUnits('length-percentage')).toContain('%');
    expect(getUnits('percentage')).toEqual(['%']);
    expect(getUnits('angle')).toEqual(['deg', 'grad', 'rad', 'turn']);
    expect(getUnits('number')).toEqual([]);
    expect(getUnits('color')).toEqual([]);
  });

  it('lists the units a descriptor accepts', () => {
    expect(
      getDescriptorUnits(
        parseSyntax('normal | <length> | <number> | <percentage>'),
      ),
    ).toEqual([...getUnits('length'), '', '%']);
    expect(
      getDescriptorUnits(parseSyntax('<length> | <length-percentage>')),
    ).toEqual(getUnits('length-percentage'));
    expect(getDescriptorUnits(parseSyntax('auto | none'))).toEqual([]);
  });

  it('accepts every unit it offers', () => {
    for (const type of [
      'length',
      'percentage',
      'angle',
      'time',
      'resolution',
    ] as const) {
      for (const unit of getUnits(type)) {
        expect(validateValue(parseSyntax(`<${type}>`), `1${unit}`)).toEqual(
          valid,
        );
      }
    }
  });
});

describe('splitDimension', () => {
  it.each([
    ['12pt', 12, 'pt'],
    [' 1.5em ', 1.5, 'em'],
    ['-0.25rem', -0.25, 'rem'],
    ['+.5%', 0.5, '%'],
    ['100%', 100, '%'],
    ['1.5', 1.5, ''],
    ['0', 0, ''],
    ['1e3px', 1000, 'px'],
    ['2E-1em', 0.2, 'em'],
    ['10Q', 10, 'Q'],
  ])('splits %j', (value, number, unit) => {
    expect(splitDimension(value)).toEqual({ number, unit });
  });

  it.each([
    '',
    'auto',
    '1 px',
    '1px 2px',
    'calc(1px)',
    '1.',
    'px',
    '#123',
    '1px;',
  ])('returns null for %j', (value) => {
    expect(splitDimension(value)).toBeNull();
  });
});

describe('joinDimension', () => {
  it('joins number and unit', () => {
    expect(joinDimension({ number: 12, unit: 'pt' })).toBe('12pt');
    expect(joinDimension({ number: -1.5, unit: '' })).toBe('-1.5');
    expect(joinDimension({ number: 50, unit: '%' })).toBe('50%');
  });

  it('drops floating point noise', () => {
    expect(joinDimension({ number: 0.1 + 0.2, unit: 'em' })).toBe('0.3em');
    expect(joinDimension({ number: 1e-9, unit: 'px' })).toBe('0px');
    expect(joinDimension({ number: Number.NaN, unit: 'px' })).toBe('0px');
  });

  it('round-trips with splitDimension', () => {
    for (const value of ['12pt', '1.5em', '-0.25rem', '50%', '0', '1.5']) {
      const dimension = splitDimension(value);
      expect(dimension && joinDimension(dimension)).toBe(value);
    }
  });
});
