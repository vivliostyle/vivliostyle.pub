import { describe, expect, it } from 'vitest';

import { loadThemeVariableSchema } from './schema';
import { describeVariable, parseSyntax } from './syntax';

describe('parseSyntax', () => {
  it('reads keyword alternatives as an enumeration', () => {
    expect(parseSyntax('auto | manual | none')).toEqual({
      universal: false,
      keywords: ['auto', 'manual', 'none'],
      types: [],
      multiplier: null,
      input: 'select',
    });
    expect(parseSyntax('-webkit-sticky|static').keywords).toEqual([
      '-webkit-sticky',
      'static',
    ]);
  });

  it('reads data types next to keywords', () => {
    expect(parseSyntax('normal | <length> | <number> | <percentage>')).toEqual({
      universal: false,
      keywords: ['normal'],
      types: ['length', 'number', 'percentage'],
      multiplier: null,
      input: 'dimension',
    });
  });

  it('reads multipliers', () => {
    expect(parseSyntax('<length-percentage>+')).toMatchObject({
      types: ['length-percentage'],
      multiplier: 'space',
    });
    expect(parseSyntax('<color>#')).toMatchObject({
      types: ['color'],
      multiplier: 'comma',
    });
  });

  it.each([
    ['<color>', 'color'],
    ['<color>+', 'color'],
    ['auto | <length-percentage>', 'dimension'],
    ['italic | normal | oblique | <angle>', 'dimension'],
    ['bold | bolder | lighter | normal | <number>', 'number'],
    ['all | digits | none | <integer>', 'number'],
    ['<integer> | <length>', 'dimension'],
    ['none | <custom-ident> | <string>', 'text'],
    ['inside | outside', 'select'],
    ['*', 'text'],
  ] as const)('suggests an input for %j', (syntax, input) => {
    expect(parseSyntax(syntax).input).toBe(input);
  });

  it.each([
    '*',
    '',
    '<unknown-type>',
    'a | <length',
    '<length> <length>',
    'a b',
  ])('falls back to a universal descriptor for %j', (syntax) => {
    expect(parseSyntax(syntax)).toEqual({
      universal: true,
      keywords: [],
      types: [],
      multiplier: null,
      input: 'text',
    });
  });
});

describe('describeVariable', () => {
  const describeUniversal = (key: string, ...properties: string[]) =>
    describeVariable({ syntax: '*', key, properties });

  it('keeps a specific syntax as it is', () => {
    expect(
      describeVariable({
        syntax: '<color>',
        key: 'x',
        properties: ['font-family'],
      }),
    ).toEqual(parseSyntax('<color>'));
  });

  it.each([
    ['color', 'color'],
    ['background-color', 'color'],
    ['border-block-end-color', 'color'],
    ['font-family', 'font-family'],
    ['margin-inline', 'dimension'],
    ['margin-block', 'dimension'],
    ['text-indent', 'dimension'],
    ['column-rule-width', 'dimension'],
    ['content', 'text'],
    ['display', 'text'],
    ['font-variant', 'text'],
    ['background', 'text'],
  ] as const)('hints at the input of a `*` variable for %s', (property, input) => {
    const descriptor = describeUniversal('x', property);
    expect(descriptor.universal).toBe(true);
    expect(descriptor.input).toBe(input);
  });

  it('describes list-valued hints', () => {
    expect(describeUniversal('x', 'font-family')).toMatchObject({
      types: ['font-family'],
      multiplier: 'comma',
    });
    expect(describeUniversal('x', 'margin-inline')).toMatchObject({
      keywords: ['auto'],
      types: ['length-percentage'],
      multiplier: 'space',
    });
  });

  it('requires every consuming property to agree', () => {
    expect(
      describeUniversal('x', 'border-top-color', 'border-bottom-color').input,
    ).toBe('color');
    expect(describeUniversal('x', 'color', 'content').input).toBe('text');
  });

  it('falls back to the name of a variable without properties', () => {
    expect(describeUniversal('color-border-alt').input).toBe('color');
    expect(describeUniversal('font-family-monospace').input).toBe(
      'font-family',
    );
    expect(describeUniversal('counter-style').input).toBe('text');
    expect(describeUniversal('color-border-alt', 'content').input).toBe('text');
  });

  it('understands every syntax of the theme', async () => {
    const { variables } = await loadThemeVariableSchema();
    for (const variable of variables) {
      expect(parseSyntax(variable.syntax).universal, variable.syntax).toBe(
        variable.syntax === '*',
      );
    }
    const inputs = new Set(variables.map((v) => describeVariable(v).input));
    expect([...inputs].sort()).toEqual([
      'color',
      'dimension',
      'font-family',
      'number',
      'select',
      'text',
    ]);
  });
});
