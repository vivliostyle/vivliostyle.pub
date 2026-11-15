import { describe, expect, it } from 'vitest';

import {
  type CssDeclaration,
  type CssRule,
  CssScanner,
  isSafeDeclarationValue,
} from './css-scanner';

function scan(css: string) {
  const scanner = new CssScanner(css);
  const rules = scanner.scanStylesheet();
  const describeRule = (rule: CssRule) =>
    `${rule.atName === null ? '' : `@${rule.atName}`}${rule.prelude.trim()}`;
  return {
    scanner,
    rules,
    names: rules.map(describeRule),
    declarations: (index = 0) => {
      const { block } = rules[index];
      return block
        ? scanner
            .scanBlock(block)
            .filter(
              (item): item is CssDeclaration => item.type === 'declaration',
            )
        : [];
    },
    value: (d: CssDeclaration) => css.slice(d.valueStart, d.valueEnd),
  };
}

describe('scanStylesheet', () => {
  it('splits statements, at-rules and qualified rules', () => {
    const css = `@charset "utf-8";
@import url(foo;bar.css) screen;
/* a { */
:root { --a: 1 }
@media print { h1 { color: red } }
h1, h2 > a[href$="}"] { color: blue }`;
    const { rules, names } = scan(css);
    expect(names).toEqual([
      '@charset"utf-8"',
      '@importurl(foo;bar.css) screen',
      ':root',
      '@mediaprint',
      'h1, h2 > a[href$="}"]',
    ]);
    expect(rules.map((r) => r.block !== null)).toEqual([
      false,
      false,
      true,
      true,
      true,
    ]);
    expect(css.slice(rules[2].start, rules[2].end)).toBe(':root { --a: 1 }');
    expect(rules.at(-1)?.end).toBe(css.length);
  });

  it('reports the block of a rule by its braces', () => {
    const css = 'a { b: "}" } c{}';
    const { rules } = scan(css);
    expect(rules[0].block).toEqual({ open: 2, close: 11, closed: true });
    expect(rules[1].block).toEqual({ open: 14, close: 15, closed: true });
  });

  it('keeps a stray top-level `}` in the prelude of the next rule', () => {
    expect(scan('} :root { --a: 1 }').names).toEqual(['} :root']);
  });

  it('skips HTML comment delimiters', () => {
    expect(scan('<!-- :root {} -->').names).toEqual([':root']);
  });

  it.each([
    ['a { --x: 1; /* open', 'unterminated-comment', 12],
    ['a { --x: "open\n }', 'unterminated-string', 9],
    ['a { --x: (1 ', 'unclosed-block', 9],
    ['a { --x: 1; ', 'unclosed-block', 2],
    ['a { b: url(x }', 'unclosed-block', 10],
  ] as const)('reports %j as %s', (css, code, offset) => {
    const { scanner, rules } = scan(css);
    expect(scanner.diagnostics).toContainEqual({ code, offset });
    expect(rules.at(-1)?.end).toBe(css.length);
  });

  it('reports no problem for well-formed input', () => {
    const { scanner } = scan(
      `a { b: "x\\"y;}" } /* ; } */ c { d: url( a;b}c ) 'e\\\n f' }`,
    );
    expect(scanner.diagnostics).toEqual([]);
  });

  it('copes with deeply nested brackets', () => {
    const depth = 200_000;
    const open = new CssScanner(`a { --x: ${'('.repeat(depth)}`);
    expect(open.scanStylesheet()).toHaveLength(1);
    expect(open.diagnostics).toHaveLength(depth + 1);
    const closed = new CssScanner(
      `a { --x: ${'('.repeat(depth)}${')'.repeat(depth)} } b {}`,
    );
    expect(closed.scanStylesheet()).toHaveLength(2);
    expect(closed.diagnostics).toEqual([]);
  });

  it('lets an unclosed bracket swallow the closing brace', () => {
    const { rules, scanner } = scan('a { b: (1; } c { d: 2 }');
    expect(rules).toHaveLength(1);
    expect(scanner.diagnostics.map((d) => d.code)).toEqual([
      'unclosed-block',
      'unclosed-block',
    ]);
  });
});

describe('scanBlock', () => {
  it('reads declarations with their value ranges', () => {
    const { declarations, value } = scan(
      ':root { --a :  1px ; --b:red!important; color: blue; --c: a b }',
    );
    const list = declarations();
    expect(
      list.map((d) => [d.name, value(d), d.important, d.terminated]),
    ).toEqual([
      ['--a', '1px', false, true],
      ['--b', 'red', true, true],
      ['color', 'blue', false, true],
      ['--c', 'a b', false, false],
    ]);
  });

  it('excludes comments and `!important` from the value range', () => {
    const css = ':root { --a: /* x */ 1px 2px /* y */ ! IMPORTANT /* z */ }';
    const { declarations, value } = scan(css);
    const [d] = declarations();
    expect(value(d)).toBe('1px 2px');
    expect(d.important).toBe(true);
    expect(css.slice(d.start, d.end)).toBe(
      '--a: /* x */ 1px 2px /* y */ ! IMPORTANT',
    );
  });

  it('does not end a value inside strings, urls and blocks', () => {
    const { declarations, value } = scan(
      `:root {
        --a: "x;y}z";
        --b: url(data:image/png;base64,AA//BB/*CC);
        --c: { a: 1; b: 2 };
        --d: fn(1; 2) [x; y];
        --e: 'it\\'s; fine';
        --f: URL( "a;b" );
      }`,
    );
    expect(declarations().map(value)).toEqual([
      '"x;y}z"',
      'url(data:image/png;base64,AA//BB/*CC)',
      '{ a: 1; b: 2 }',
      'fn(1; 2) [x; y]',
      "'it\\'s; fine'",
      'URL( "a;b" )',
    ]);
  });

  it('reads an empty value', () => {
    const { declarations, value } = scan(
      ':root { --a:; --b: ; --c: !important }',
    );
    expect(declarations().map((d) => [value(d), d.important])).toEqual([
      ['', false],
      ['', false],
      ['', true],
    ]);
  });

  it('extends a custom property over a block up to the semicolon', () => {
    const { declarations, value } = scan(
      ':root { --a:hover { x } --b: 1; --c: 2 }',
    );
    expect(declarations().map((d) => [d.name, value(d)])).toEqual([
      ['--a', 'hover { x } --b: 1'],
      ['--c', '2'],
    ]);
  });

  it('tells nested rules from declarations', () => {
    const { scanner, rules } = scan(
      `:root {
        --a: 1;
        a:hover { --b: 2 }
        & .x { --c: 3; }
        @media print { --d: 4 }
        --e:hover { x };
        --f: 6
      }`,
    );
    const items = scanner.scanBlock(
      rules[0].block ?? { open: 0, close: 0, closed: false },
    );
    expect(
      items.map((item) => (item.type === 'rule' ? 'rule' : item.name)),
    ).toEqual(['--a', 'rule', 'rule', 'rule', '--e', '--f']);
  });

  it('isolates junk up to the next semicolon', () => {
    const { scanner, rules } = scan(':root { colo; --a: 1; oops }');
    const items = scanner.scanBlock(
      rules[0].block ?? { open: 0, close: 0, closed: false },
    );
    expect(
      items.map((item) => [
        item.type === 'rule' ? 'rule' : item.name,
        item.terminated,
      ]),
    ).toEqual([
      ['rule', true],
      ['--a', true],
      ['rule', false],
    ]);
    expect(items[2].end).toBe(26);
  });

  it('flags values that void their declaration', () => {
    const { declarations } = scan(
      ':root { --a: 1 ) 2; --b: a ! b; --c: ]; --d: "!)]" (!) }',
    );
    expect(declarations().map((d) => d.malformed)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});

describe('scanValue', () => {
  it.each([
    ['1px  2.5em', ['1px', '2.5em']],
    ['rgb(0 0 0 / 50%) #fff', ['rgb(0 0 0 / 50%)', '#fff']],
    ["'Foo Bar', serif", ["'Foo Bar'", ',', 'serif']],
    ['var(--a, 1px)/2', ['var(--a, 1px)', '/', '2']],
    ['-1.5e3px +2% .5', ['-1.5e3px', '+2%', '.5']],
    ['url(a b) /* c */ x', ['url(a b)', 'x']],
    ['[a b] {c}', ['[a b]', '{c}']],
  ])('splits %j', (value, tokens) => {
    expect(new CssScanner(value).scanValue()).toEqual(tokens);
  });
});

describe('isSafeDeclarationValue', () => {
  it.each([
    '1px',
    "'a;b}c'",
    'url(data:image/png;base64,AAA=)',
    'calc((1em + 2px) * 2)',
    '{ a: b; c: d }',
    'a /* b */ c',
    '"!"',
  ])('accepts %j', (value) => {
    expect(isSafeDeclarationValue(value)).toBe(true);
  });

  it.each([
    'a; b',
    'red; } h1 { color: blue',
    'a }',
    'a ) b',
    'a ] b',
    '(a',
    '"a',
    "'a\nb'",
    'a /* b',
    'url(a',
    'red !important',
    'a ! b',
  ])('rejects %j', (value) => {
    expect(isSafeDeclarationValue(value)).toBe(false);
  });
});
