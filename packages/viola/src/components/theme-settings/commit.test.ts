import { describe, expect, it } from 'vitest';

import { parseSyntax, parseThemeCss } from '../../libs/theme-variables';
import { commitValue } from './commit';

const length = parseSyntax('auto | <length-percentage>');
const name = '--vs-page--margin-inside';

describe('commitValue', () => {
  it('writes a valid value into the scope', () => {
    const result = commitValue('', {
      scope: 'root',
      name,
      descriptor: length,
      value: ' 12mm ',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(parseThemeCss(result.css).scopes.root.variables[name]?.value).toBe(
        '12mm',
      );
    }
  });

  it('keeps the rest of the stylesheet untouched', () => {
    const css = 'body { color: red; }\n:root {\n  --x: 1;\n}\n';
    const result = commitValue(css, {
      scope: 'root',
      name,
      descriptor: length,
      value: 'auto',
    });
    expect(result).toEqual({
      ok: true,
      css: `body { color: red; }\n:root {\n  --x: 1;\n  ${name}: auto;\n}\n`,
    });
  });

  it('unsets the variable for an empty value', () => {
    const css = `:root {\n  ${name}: 1em;\n}\n`;
    expect(
      commitValue(css, { scope: 'root', name, descriptor: length, value: '' }),
    ).toEqual({ ok: true, css: '' });
  });

  it('accepts var() and calc() for a typed variable', () => {
    for (const value of ['var(--x)', 'calc(1em + 2mm)']) {
      expect(
        commitValue('', { scope: 'page', name, descriptor: length, value }).ok,
      ).toBe(true);
    }
  });

  it.each([
    ['12', 'missing-unit'],
    ['12zz', 'unknown-unit'],
    ['bogus', 'not-allowed'],
    ['1em;', 'malformed'],
  ])('rejects %s with %s', (value, error) => {
    expect(
      commitValue('', { scope: 'root', name, descriptor: length, value }),
    ).toEqual({ ok: false, error });
  });

  it('reports an edit swallowed by a broken stylesheet', () => {
    expect(
      commitValue(':root { --a: "x', {
        scope: 'page',
        name,
        descriptor: length,
        value: '1em',
      }),
    ).toEqual({ ok: false, error: 'unsafe-edit' });
  });
});
