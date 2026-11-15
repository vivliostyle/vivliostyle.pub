import { describe, expect, it } from 'vitest';

import {
  parseThemeCss,
  removeVariable,
  setVariable,
  ThemeCssEditError,
  type ThemeCssModel,
} from './css-model';
import { THEME_SCOPES, type ThemeScopeId } from './scopes';

const SCOPE_IDS = THEME_SCOPES.map((scope) => scope.id);

function valuesOf(css: string, scope: ThemeScopeId = 'root') {
  return Object.fromEntries(
    Object.values(parseThemeCss(css).scopes[scope].variables).map((v) => [
      v.name,
      v.value,
    ]),
  );
}

function lines(...parts: string[]): string {
  return `${parts.join('\n')}\n`;
}

describe('parseThemeCss', () => {
  it('reports every scope, present or not', () => {
    const model = parseThemeCss('');
    expect(Object.keys(model.scopes)).toEqual(SCOPE_IDS);
    for (const id of SCOPE_IDS) {
      expect(model.scopes[id]).toEqual({ exists: false, variables: {} });
    }
    expect(model.diagnostics).toEqual([]);
  });

  it('reads the custom properties of each preset scope', () => {
    const css = lines(
      "@import '@vivliostyle/theme-base';",
      ':root { --vs-font-size: 12pt; color: red; --vs-color-foreground: #333 }',
      '@page { --vs-page--margin: 20mm; margin: 1in; @top-left { --vs-x: 1 } }',
      '@page :left { --vs-page--margin-left: 25mm }',
      '@page :right { --vs-page--margin-right: 26mm }',
      '@page :first { --vs-page--margin-top: 40mm }',
      '@media print { :root { --vs-font-size: 10pt } h1 { --vs-x: 1 } }',
      '@media screen { :root { --vs-font-size: 16px } }',
    );
    expect(valuesOf(css, 'root')).toEqual({
      '--vs-font-size': '12pt',
      '--vs-color-foreground': '#333',
    });
    expect(valuesOf(css, 'page')).toEqual({ '--vs-page--margin': '20mm' });
    expect(valuesOf(css, 'page-left')).toEqual({
      '--vs-page--margin-left': '25mm',
    });
    expect(valuesOf(css, 'page-right')).toEqual({
      '--vs-page--margin-right': '26mm',
    });
    expect(valuesOf(css, 'page-first')).toEqual({
      '--vs-page--margin-top': '40mm',
    });
    expect(valuesOf(css, 'print-root')).toEqual({ '--vs-font-size': '10pt' });
    expect(valuesOf(css, 'screen-root')).toEqual({ '--vs-font-size': '16px' });
  });

  it('matches scope rules regardless of case, spacing and comments', () => {
    const css = lines(
      ':ROOT{--a:1}',
      '  :root /* x */ { --b: 2 }',
      '@PAGE{--c:3}',
      '@page:LEFT{--d:4}',
      '@page   :right   {--e:5}',
      '@MEDIA   Print{:Root{--f:6}}',
      '@media/**/screen/**/{ :root { --g: 7 } }',
    );
    expect(valuesOf(css, 'root')).toEqual({ '--a': '1', '--b': '2' });
    expect(valuesOf(css, 'page')).toEqual({ '--c': '3' });
    expect(valuesOf(css, 'page-left')).toEqual({ '--d': '4' });
    expect(valuesOf(css, 'page-right')).toEqual({ '--e': '5' });
    expect(valuesOf(css, 'print-root')).toEqual({ '--f': '6' });
    expect(valuesOf(css, 'screen-root')).toEqual({ '--g': '7' });
  });

  it('ignores rules that are not exactly a preset scope', () => {
    const css = lines(
      ':root:lang(ja) { --a: 1 }',
      ':root, :host { --a: 1 }',
      'html { --a: 1 }',
      '.x :root { --a: 1 }',
      '@page chapter { --a: 1 }',
      '@page :left:first { --a: 1 }',
      '@page :blank { --a: 1 }',
      '@media print and (min-width: 1px) { :root { --a: 1 } }',
      '@media only screen { :root { --a: 1 } }',
      '@media print { @supports (x: y) { :root { --a: 1 } } }',
      '@media print { @page { --a: 1 } }',
      '@supports (x: y) { :root { --a: 1 } }',
      '@layer base { :root { --a: 1 } }',
      ':root { .x { --a: 1 } }',
      '} :root { --a: 1 }',
    );
    const model = parseThemeCss(css);
    for (const id of SCOPE_IDS) {
      expect(model.scopes[id].variables).toEqual({});
    }
    expect(model.scopes.root.exists).toBe(true);
    expect(model.scopes.page.exists).toBe(false);
  });

  it('reports the declaration that wins the cascade', () => {
    const css = lines(
      ':root { --a: 1; --a: 2; --b: 1 !important; --b: 2 }',
      ':root { --a: 3; --c: 1 !important }',
      ':root { --c: 2 !important; --c: 3 }',
    );
    const { variables } = parseThemeCss(css).scopes.root;
    expect(variables['--a']).toMatchObject({ value: '3', count: 3 });
    expect(variables['--b']).toMatchObject({
      value: '1',
      important: true,
      count: 2,
    });
    expect(variables['--c']).toMatchObject({
      value: '2',
      important: true,
      count: 3,
    });
  });

  it('reports source ranges of the effective declaration', () => {
    const css = ':root {\n  --a:  1px  2px  !important ;\n}';
    const variable = parseThemeCss(css).scopes.root.variables['--a'];
    expect(css.slice(variable.start, variable.end)).toBe(
      '--a:  1px  2px  !important ;',
    );
    expect(css.slice(variable.valueStart, variable.valueEnd)).toBe('1px  2px');
    expect(variable.value).toBe('1px  2px');
  });

  it('keeps tricky values intact', () => {
    const css = lines(
      ':root {',
      '  --a: "x;y}z";',
      '  --b: url(data:image/png;base64,AA==);',
      "  --c: 'Foo Bar',",
      '    serif;',
      '  --d: /* lead */ calc(1em + 2px) /* trail */;',
      '  --e: { a: b; c: d };',
      '}',
    );
    expect(valuesOf(css)).toEqual({
      '--a': '"x;y}z"',
      '--b': 'url(data:image/png;base64,AA==)',
      '--c': "'Foo Bar',\n    serif",
      '--d': 'calc(1em + 2px)',
      '--e': '{ a: b; c: d }',
    });
  });

  it('skips declarations that are commented out', () => {
    expect(valuesOf(':root { /* --a: 1; */ --b: 2; /* --c: 3 */ }')).toEqual({
      '--b': '2',
    });
  });

  it.each([
    [':root { --a: 1; /* open', 'unterminated-comment'],
    [':root { --a: "open\n; --b: 2 }', 'unterminated-string'],
    [':root { --a: 1;', 'unclosed-block'],
    ['h1 { color: red;\n:root { --a: 1 }', 'unclosed-block'],
  ] as const)('degrades gracefully on %j', (css, code) => {
    const model = parseThemeCss(css);
    expect(model.diagnostics.map((d) => d.code)).toContain(code);
  });

  it('still reads what precedes a syntax error', () => {
    expect(valuesOf(':root { --a: 1; --b: 2; /* open')).toEqual({
      '--a': '1',
      '--b': '2',
    });
    expect(valuesOf(':root { --a: 1;\n  --b: (2')).toEqual({
      '--a': '1',
      '--b': '(2',
    });
  });

  it('never throws on garbage', () => {
    const garbage = [
      '{',
      '}',
      '}}}{{{',
      '@',
      '@;',
      '@media',
      ':root',
      ':root {',
      ':root { --',
      ':root { --a',
      ':root { --a:',
      ':root { : }',
      '"',
      "'\\",
      '/*',
      '/',
      '\\',
      'url(',
      '@media print { :root {',
      '@page :left { --a: (((',
      '<!-- -->',
      ';;;',
      '\u0000\uffff',
    ];
    for (const css of garbage) {
      expect(() => parseThemeCss(css)).not.toThrow();
      for (const id of SCOPE_IDS) {
        try {
          const out = setVariable(css, id, '--vs-x', '1');
          expect(valuesOf(out, id)['--vs-x']).toBe('1');
        } catch (error) {
          expect(error).toBeInstanceOf(ThemeCssEditError);
        }
        expect(() => removeVariable(css, id, '--vs-x')).not.toThrow();
      }
    }
  });
});

describe('setVariable', () => {
  it('creates the scope rule in an empty stylesheet', () => {
    expect(setVariable('', 'root', '--vs-font-size', '12pt')).toBe(
      lines(':root {', '  --vs-font-size: 12pt;', '}'),
    );
    expect(setVariable('', 'page-left', '--vs-page--margin', '2cm')).toBe(
      lines('@page :left {', '  --vs-page--margin: 2cm;', '}'),
    );
    expect(setVariable('', 'print-root', '--vs-font-size', '10pt')).toBe(
      lines(
        '@media print {',
        '  :root {',
        '    --vs-font-size: 10pt;',
        '  }',
        '}',
      ),
    );
  });

  it('places a new rule after the statements that must stay first', () => {
    const css = lines(
      '@charset "utf-8";',
      '@layer base, theme;',
      "@import '@vivliostyle/theme-base';",
      "@import url('@vivliostyle/theme-base/page');",
      "@namespace svg url('http://www.w3.org/2000/svg');",
      '',
      'h1 {',
      '  color: red;',
      '}',
    );
    expect(setVariable(css, 'root', '--vs-a', '1')).toBe(
      lines(
        '@charset "utf-8";',
        '@layer base, theme;',
        "@import '@vivliostyle/theme-base';",
        "@import url('@vivliostyle/theme-base/page');",
        "@namespace svg url('http://www.w3.org/2000/svg');",
        '',
        ':root {',
        '  --vs-a: 1;',
        '}',
        '',
        'h1 {',
        '  color: red;',
        '}',
      ),
    );
  });

  it('places a new rule after detached leading comments only', () => {
    const css = lines(
      '/**',
      ' * Custom styles',
      ' */',
      '',
      "/* @import '@vivliostyle/theme-base/page'; */",
      '',
      '/* Headings */',
      'h1 { color: red }',
    );
    expect(setVariable(css, 'root', '--vs-a', '1')).toBe(
      lines(
        '/**',
        ' * Custom styles',
        ' */',
        '',
        "/* @import '@vivliostyle/theme-base/page'; */",
        '',
        ':root {',
        '  --vs-a: 1;',
        '}',
        '',
        '/* Headings */',
        'h1 { color: red }',
      ),
    );
    expect(setVariable('/* Headings */\nh1 {}\n', 'root', '--vs-a', '1')).toBe(
      lines(':root {', '  --vs-a: 1;', '}', '', '/* Headings */', 'h1 {}'),
    );
  });

  it('appends a rule to a stylesheet without a final newline', () => {
    expect(setVariable("@import 'a.css';", 'root', '--vs-a', '1')).toBe(
      lines("@import 'a.css';", '', ':root {', '  --vs-a: 1;', '}'),
    );
  });

  it('orders new rules by scope, keeping `:root` ahead of its overrides', () => {
    let css = setVariable('h1 {}\n', 'print-root', '--vs-a', '1');
    css = setVariable(css, 'page-left', '--vs-b', '2');
    css = setVariable(css, 'root', '--vs-a', '3');
    css = setVariable(css, 'screen-root', '--vs-a', '4');
    css = setVariable(css, 'page', '--vs-b', '5');
    expect(css).toBe(
      lines(
        ':root {',
        '  --vs-a: 3;',
        '}',
        '',
        '@page {',
        '  --vs-b: 5;',
        '}',
        '',
        '@page :left {',
        '  --vs-b: 2;',
        '}',
        '',
        '@media print {',
        '  :root {',
        '    --vs-a: 1;',
        '  }',
        '}',
        '',
        '@media screen {',
        '  :root {',
        '    --vs-a: 4;',
        '  }',
        '}',
        '',
        'h1 {}',
      ),
    );
  });

  it('keeps a comment attached to the rule it is placed before', () => {
    const css = lines(
      '/* Header */',
      '',
      'h1 {} /* trailing */',
      '/* Page setup',
      '',
      '   in detail */',
      '/* More */',
      '@page {',
      '  margin: 1in;',
      '}',
    );
    expect(setVariable(css, 'root', '--vs-a', '1')).toBe(
      css.replace('/* Page setup', ':root {\n  --vs-a: 1;\n}\n\n/* Page setup'),
    );
    expect(setVariable('/* Page */\n@page {}\n', 'root', '--vs-a', '1')).toBe(
      ':root {\n  --vs-a: 1;\n}\n\n/* Page */\n@page {}\n',
    );
    expect(
      setVariable('/* a\n\n b */\n@page {}\n', 'root', '--vs-a', '1'),
    ).toBe(':root {\n  --vs-a: 1;\n}\n\n/* a\n\n b */\n@page {}\n');
  });

  it('puts a `@media` scope after a `:root` rule that follows other rules', () => {
    const css = lines('h1 {}', '', ':root {', '  --vs-a: 1;', '}', '', 'h2 {}');
    expect(setVariable(css, 'print-root', '--vs-a', '2')).toBe(
      lines(
        'h1 {}',
        '',
        ':root {',
        '  --vs-a: 1;',
        '}',
        '',
        '@media print {',
        '  :root {',
        '    --vs-a: 2;',
        '  }',
        '}',
        '',
        'h2 {}',
      ),
    );
  });

  it('does not reuse a `@media` rule that lacks a `:root` rule', () => {
    const css = lines('@media print {', '  h1 { color: red }', '}');
    expect(setVariable(css, 'print-root', '--vs-a', '1')).toBe(
      lines(
        '@media print {',
        '  :root {',
        '    --vs-a: 1;',
        '  }',
        '}',
        '',
        '@media print {',
        '  h1 { color: red }',
        '}',
      ),
    );
  });

  it('updates a value in place', () => {
    const css = lines(
      ':root {',
      '  /* Base font size */',
      '  --vs-font-size:   11pt  ; /* was 10pt */',
      '  color: red;',
      '}',
    );
    expect(setVariable(css, 'root', '--vs-font-size', '12pt')).toBe(
      css.replace('11pt', '12pt'),
    );
  });

  it('keeps `!important` and comments around a replaced value', () => {
    expect(
      setVariable(
        ':root{--a:/* x */1px/* y */!important;--b:2}',
        'root',
        '--a',
        '3px',
      ),
    ).toBe(':root{--a:/* x */3px/* y */!important;--b:2}');
  });

  it('replaces a multi-line value', () => {
    const css = lines(
      ':root {',
      '  --vs-font-family:',
      '    system-ui, -apple-system, "Segoe UI",',
      '    sans-serif;',
      '  --b: 1;',
      '}',
    );
    expect(setVariable(css, 'root', '--vs-font-family', 'serif')).toBe(
      lines(':root {', '  --vs-font-family:', '    serif;', '  --b: 1;', '}'),
    );
  });

  it('fills in an empty value', () => {
    expect(setVariable(':root { --a:; }', 'root', '--a', '1')).toBe(
      ':root { --a: 1; }',
    );
    expect(setVariable(':root { --a: !important }', 'root', '--a', '1')).toBe(
      ':root { --a: 1 !important }',
    );
  });

  it('appends a declaration matching the indentation of the block', () => {
    expect(
      setVariable(
        ':root {\n    --a: 1;\n    color: red;\n}\n',
        'root',
        '--b',
        '2',
      ),
    ).toBe(':root {\n    --a: 1;\n    color: red;\n    --b: 2;\n}\n');
    expect(setVariable(':root {\n\t--a: 1;\n}\n', 'root', '--b', '2')).toBe(
      ':root {\n\t--a: 1;\n\t--b: 2;\n}\n',
    );
    expect(
      setVariable('h1 {\n\tcolor: red;\n}\n:root {\n}\n', 'root', '--b', '2'),
    ).toBe('h1 {\n\tcolor: red;\n}\n:root {\n\t--b: 2;\n}\n');
  });

  it('terminates the preceding declaration when needed', () => {
    expect(setVariable(':root {\n  --a: 1\n}\n', 'root', '--b', '2')).toBe(
      ':root {\n  --a: 1;\n  --b: 2;\n}\n',
    );
    expect(
      setVariable(':root {\n  --a: 1 /* note */\n}\n', 'root', '--b', '2'),
    ).toBe(':root {\n  --a: 1; /* note */\n  --b: 2;\n}\n');
    expect(setVariable(':root {\n  colo\n}\n', 'root', '--b', '2')).toBe(
      ':root {\n  colo;\n  --b: 2;\n}\n',
    );
  });

  it('appends after trailing comments and nested rules', () => {
    expect(
      setVariable(
        ':root {\n  --a: 1; /* note */\n  /* --c: 3; */\n}\n',
        'root',
        '--b',
        '2',
      ),
    ).toBe(':root {\n  --a: 1; /* note */\n  /* --c: 3; */\n  --b: 2;\n}\n');
    expect(
      setVariable(
        '@page {\n  margin: 1in;\n  @top-left {\n    content: "x";\n  }\n}\n',
        'page',
        '--b',
        '2',
      ),
    ).toBe(
      '@page {\n  margin: 1in;\n  @top-left {\n    content: "x";\n  }\n  --b: 2;\n}\n',
    );
  });

  it('follows the style of single-line and minified blocks', () => {
    expect(setVariable(':root { --a: 1; }', 'root', '--b', '2')).toBe(
      ':root { --a: 1; --b: 2; }',
    );
    expect(setVariable(':root { --a: 1 }', 'root', '--b', '2')).toBe(
      ':root { --a: 1; --b: 2; }',
    );
    expect(setVariable(':root{--a:1}', 'root', '--b', '2')).toBe(
      ':root{--a:1;--b:2}',
    );
    expect(setVariable(':root{--a:1;}', 'root', '--b', '2')).toBe(
      ':root{--a:1;--b:2;}',
    );
    expect(setVariable(':root{}h1{color:red}', 'root', '--b', '2')).toBe(
      ':root{--b:2}h1{color:red}',
    );
    expect(setVariable('h1{color:red}', 'page', '--b', '2')).toBe(
      '@page{--b:2}h1{color:red}',
    );
    expect(setVariable(':root{--a:1}', 'screen-root', '--b', '2')).toBe(
      ':root{--a:1}@media screen{:root{--b:2}}',
    );
  });

  it('expands an empty block', () => {
    expect(setVariable(':root {}\n', 'root', '--b', '2')).toBe(
      ':root {\n  --b: 2;\n}\n',
    );
    expect(setVariable(':root { }\n\nh1 {}\n', 'root', '--b', '2')).toBe(
      ':root {\n  --b: 2;\n}\n\nh1 {}\n',
    );
    expect(
      setVariable('@media print {\n  :root {}\n}\n', 'print-root', '--b', '2'),
    ).toBe('@media print {\n  :root {\n    --b: 2;\n  }\n}\n');
  });

  it('preserves CRLF line endings', () => {
    const css = ':root {\r\n  --a: 1;\r\n}\r\n';
    expect(setVariable(css, 'root', '--b', '2')).toBe(
      ':root {\r\n  --a: 1;\r\n  --b: 2;\r\n}\r\n',
    );
    expect(setVariable(css, 'page', '--b', '2')).toBe(
      ':root {\r\n  --a: 1;\r\n}\r\n\r\n@page {\r\n  --b: 2;\r\n}\r\n',
    );
    expect(setVariable(css, 'root', '--a', '3')).toBe(
      ':root {\r\n  --a: 3;\r\n}\r\n',
    );
  });

  it('writes to the last rule of a scope declared more than once', () => {
    const css = lines(
      ':root {',
      '  --a: 1;',
      '}',
      'h1 {}',
      ':root {',
      '  --b: 2;',
      '}',
    );
    expect(setVariable(css, 'root', '--c', '3')).toBe(
      lines(
        ':root {',
        '  --a: 1;',
        '}',
        'h1 {}',
        ':root {',
        '  --b: 2;',
        '  --c: 3;',
        '}',
      ),
    );
    expect(setVariable(css, 'root', '--a', '4')).toBe(
      css.replace('--a: 1', '--a: 4'),
    );
  });

  it('leaves a single declaration of a duplicated variable', () => {
    const css = lines(
      ':root {',
      '  --a: 1;',
      '  --b: 0;',
      '  --a: 2;',
      '}',
      ':root {',
      '  --a: 3; /* kept */',
      '}',
    );
    expect(setVariable(css, 'root', '--a', '9')).toBe(
      lines(
        ':root {',
        '  --b: 0;',
        '}',
        ':root {',
        '  --a: 9; /* kept */',
        '}',
      ),
    );
  });

  it('keeps the `!important` declaration that wins among duplicates', () => {
    const css = lines(
      ':root {',
      '  --a: 1 !important;',
      '}',
      '',
      ':root {',
      '  --a: 2;',
      '}',
      '',
      'h1 {}',
    );
    expect(setVariable(css, 'root', '--a', '9')).toBe(
      lines(':root {', '  --a: 9 !important;', '}', '', 'h1 {}'),
    );
  });

  it('does not touch the same variable in other scopes', () => {
    const css = lines(
      ':root { --a: 1 }',
      ':root:lang(ja) { --a: 1 }',
      '@media print { :root { --a: 1 } }',
      '@media screen { :root { --a: 1 } }',
      '@page { --a: 1 }',
    );
    expect(setVariable(css, 'print-root', '--a', '2')).toBe(
      css.replace(
        '@media print { :root { --a: 1 } }',
        '@media print { :root { --a: 2 } }',
      ),
    );
  });

  it('normalizes the value like the parser reports it', () => {
    const out = setVariable('', 'root', '--a', '  /* c */ 1px  2px /* d */ ');
    expect(valuesOf(out)).toEqual({ '--a': '1px  2px' });
  });

  it.each([
    ['', 'invalid-value'],
    ['   ', 'invalid-value'],
    ['/* only a comment */', 'invalid-value'],
    ['red; color: blue', 'invalid-value'],
    ['red } h1 { color: blue', 'invalid-value'],
    ['red !important', 'invalid-value'],
    ['"unterminated', 'invalid-value'],
    ['(unbalanced', 'invalid-value'],
    ['a /* open', 'invalid-value'],
  ] as const)('rejects the value %j', (value, code) => {
    expect(() => setVariable(':root {}', 'root', '--a', value)).toThrow(
      expect.objectContaining({ code }),
    );
  });

  it.each([
    'a',
    '-a',
    '--',
    '--a b',
    '--a:b',
    '--a;',
    '',
  ])('rejects the name %j', (name) => {
    expect(() => setVariable('', 'root', name, '1')).toThrow(
      expect.objectContaining({ code: 'invalid-name' }),
    );
    expect(() => removeVariable('', 'root', name)).toThrow(ThemeCssEditError);
  });

  it.each([
    [':root { --a: 1; /* open', 'root'],
    [':root { --a: (1;', 'root'],
    [':root {\n  --a: 1;', 'page'],
    ['@media print {\n  :root {\n    --a: 1;\n  }\n', 'screen-root'],
  ] as const)('refuses an edit that %j would swallow', (css, scope) => {
    expect(() => setVariable(css, scope, '--b', '2')).toThrow(
      expect.objectContaining({ code: 'unsafe-edit' }),
    );
  });

  it('writes ahead of a syntax error where it can', () => {
    expect(setVariable('h1 { color: red }\n/* open', 'root', '--b', '2')).toBe(
      ':root {\n  --b: 2;\n}\n\nh1 { color: red }\n/* open',
    );
  });

  it('edits a rule that is still open at the end of input', () => {
    expect(setVariable(':root {\n  --a: 1;', 'root', '--b', '2')).toBe(
      ':root {\n  --a: 1;\n  --b: 2;',
    );
    expect(setVariable(':root {\n  --a: 1', 'root', '--a', '2')).toBe(
      ':root {\n  --a: 2',
    );
  });
});

describe('removeVariable', () => {
  it('removes the line of a declaration', () => {
    const css = lines(':root {', '  --a: 1;', '  --b: 2;', '  --c: 3', '}');
    expect(removeVariable(css, 'root', '--a')).toBe(
      lines(':root {', '  --b: 2;', '  --c: 3', '}'),
    );
    expect(removeVariable(css, 'root', '--b')).toBe(
      lines(':root {', '  --a: 1;', '  --c: 3', '}'),
    );
    expect(removeVariable(css, 'root', '--c')).toBe(
      lines(':root {', '  --a: 1;', '  --b: 2;', '}'),
    );
  });

  it('removes a multi-line declaration', () => {
    const css = lines(
      ':root {',
      '  --a:',
      '    "x",',
      '    serif;',
      '  --b: 2;',
      '}',
    );
    expect(removeVariable(css, 'root', '--a')).toBe(
      lines(':root {', '  --b: 2;', '}'),
    );
  });

  it('keeps comments that surround the declaration', () => {
    const css = lines(
      ':root {',
      '  /* Base font size */',
      '  --a: 1; /* note */',
      '  --b: 2;',
      '}',
    );
    expect(removeVariable(css, 'root', '--a')).toBe(
      lines(
        ':root {',
        '  /* Base font size */',
        '  /* note */',
        '  --b: 2;',
        '}',
      ),
    );
  });

  it('removes inline and minified declarations', () => {
    expect(removeVariable(':root { --a: 1; --b: 2; }', 'root', '--a')).toBe(
      ':root { --b: 2; }',
    );
    expect(removeVariable(':root { --a: 1; --b: 2 }', 'root', '--b')).toBe(
      ':root { --a: 1; }',
    );
    expect(removeVariable(':root{--a:1;--b:2}', 'root', '--a')).toBe(
      ':root{--b:2}',
    );
    expect(removeVariable(':root{--a:1;--b:2}', 'root', '--b')).toBe(
      ':root{--a:1;}',
    );
  });

  it('removes every duplicate', () => {
    const css = lines(
      ':root {',
      '  --a: 1;',
      '  --b: 0;',
      '  --a: 2 !important;',
      '}',
      'h1 {}',
      ':root {',
      '  --a: 3;',
      '}',
    );
    expect(removeVariable(css, 'root', '--a')).toBe(
      lines(':root {', '  --b: 0;', '}', 'h1 {}'),
    );
  });

  it('removes a rule left empty, with the blank line that set it off', () => {
    const rule = [':root {', '  --a: 1;', '}'];
    expect(removeVariable(lines(...rule), 'root', '--a')).toBe('');
    expect(
      removeVariable(lines("@import 'a';", '', ...rule), 'root', '--a'),
    ).toBe(lines("@import 'a';"));
    expect(removeVariable(lines(...rule, '', 'h1 {}'), 'root', '--a')).toBe(
      lines('h1 {}'),
    );
    expect(
      removeVariable(lines('h1 {}', '', ...rule, '', 'h2 {}'), 'root', '--a'),
    ).toBe(lines('h1 {}', '', 'h2 {}'));
    expect(
      removeVariable(lines('h1 {}', ...rule, 'h2 {}'), 'root', '--a'),
    ).toBe(lines('h1 {}', 'h2 {}'));
    expect(removeVariable(':root{--a:1}h1{}', 'root', '--a')).toBe('h1{}');
  });

  it('removes an emptied `@media` wrapper, but not one with other rules', () => {
    expect(
      removeVariable(
        lines(
          'h1 {}',
          '',
          '@media print {',
          '  :root {',
          '    --a: 1;',
          '  }',
          '}',
        ),
        'print-root',
        '--a',
      ),
    ).toBe(lines('h1 {}'));
    expect(
      removeVariable(
        lines(
          '@media print {',
          '  :root {',
          '    --a: 1;',
          '  }',
          '  h1 {}',
          '}',
        ),
        'print-root',
        '--a',
      ),
    ).toBe(lines('@media print {', '  h1 {}', '}'));
    expect(
      removeVariable('@media print{:root{--a:1}h1{}}', 'print-root', '--a'),
    ).toBe('@media print{h1{}}');
  });

  it('keeps a rule that still holds a comment or another declaration', () => {
    expect(
      removeVariable(
        lines(':root {', '  /* --b: 2; */', '  --a: 1;', '}'),
        'root',
        '--a',
      ),
    ).toBe(lines(':root {', '  /* --b: 2; */', '}'));
    expect(
      removeVariable(
        lines(':root {', '  --a: 1;', '  color: red;', '}'),
        'root',
        '--a',
      ),
    ).toBe(lines(':root {', '  color: red;', '}'));
  });

  it('leaves other empty rules alone', () => {
    const css = lines(':root {}', '', ':root {', '  --a: 1;', '}', '', 'h1 {}');
    expect(removeVariable(css, 'root', '--a')).toBe(
      lines(':root {}', '', 'h1 {}'),
    );
  });

  it('returns the input when there is nothing to remove', () => {
    const css = lines(':root { --a: 1 }', '@page { --b: 2 }');
    expect(removeVariable(css, 'root', '--b')).toBe(css);
    expect(removeVariable(css, 'page-left', '--b')).toBe(css);
    expect(removeVariable('', 'root', '--b')).toBe('');
  });

  it('preserves CRLF line endings', () => {
    expect(
      removeVariable(
        'h1 {}\r\n\r\n:root {\r\n  --a: 1;\r\n  --b: 2;\r\n}\r\n',
        'root',
        '--a',
      ),
    ).toBe('h1 {}\r\n\r\n:root {\r\n  --b: 2;\r\n}\r\n');
    expect(
      removeVariable(
        'h1 {}\r\n\r\n:root {\r\n  --a: 1;\r\n}\r\n',
        'root',
        '--a',
      ),
    ).toBe('h1 {}\r\n');
  });
});

describe('round trip', () => {
  const TEMPLATE = lines(
    '/**',
    ' * Custom Styles; with a } brace and a "quote',
    ' */',
    '',
    "/* @import '@vivliostyle/theme-base/page'; */",
    '',
    ':root {',
    '  /* ===== Typography ===== */',
    '',
    '  /* Base font family */',
    '  --vs-font-family:',
    '    system-ui, -apple-system, "Segoe UI", sans-serif;',
    '',
    '  /* --vs-font-size: 11pt; */',
    '  --vs-line-height: 1.8; /* loose */',
    '  --vs--h1-font-size: 2em !important;',
    '}',
    '',
    '@page {',
    '  --vs-page--margin: 20mm;',
    '  @top-center {',
    '    content: "a;b}c";',
    '  }',
    '}',
    '',
    'h1::before {',
    '  content: "} :root { --vs-font-size: 1px }";',
    "  background: url(data:image/svg+xml;utf8,<svg xmlns='x'/>);",
    '}',
  );

  const FIXTURES: Record<string, string> = {
    empty: '',
    blank: '\n\n',
    template: TEMPLATE,
    crlf: TEMPLATE.replaceAll('\n', '\r\n'),
    tabs: TEMPLATE.replaceAll('  ', '\t'),
    imports: lines(
      '@charset "utf-8";',
      "@import '@vivliostyle/theme-base';",
      '@import url(https://example.com/a;b.css) print;',
      '',
      'h1 { color: red }',
    ),
    minified:
      '@import "a.css";:root{--vs-font-size:12pt;--vs-line-height:1.5}@page{--vs-page--margin:20mm}@page :left{--vs-page--margin-left:1in}@media print{:root{--vs-font-size:10pt}h1{color:red}}@media screen{:root{--vs-line-height:2}}h1{content:"}"}',
    'no semicolons': lines(
      ':root { --vs-font-size: 12pt }',
      '@page { --vs-page--margin: 20mm }',
      '@page :first { margin: 0 }',
      '@media print {',
      '  :root {',
      '    --vs-font-size: 10pt',
      '  }',
      '}',
    ),
    duplicates: lines(
      ':root {',
      '  --vs-font-size: 10pt;',
      '  --vs-font-size: 11pt;',
      '  --vs-line-height: 1.5 !important;',
      '}',
      '',
      'h1 { --vs-font-size: 3em }',
      '',
      ':root {',
      '  --vs-font-size: 12pt;',
      '  --vs-line-height: 2;',
      '}',
      '',
      '@media print { :root { --vs-font-size: 9pt } }',
      '@media print { :root { --vs-font-size: 8pt; --vs-line-height: 1 } }',
    ),
    nested: lines(
      '@layer base {',
      '  :root { --vs-font-size: 1px }',
      '}',
      '@supports (display: grid) {',
      '  @media print {',
      '    :root { --vs-font-size: 2px }',
      '  }',
      '}',
      '@media print {',
      '  h1 { color: red }',
      '  @page { --vs-page--margin: 1mm }',
      '  :root {',
      '    --vs-font-size: 3px;',
      '    .x & { --vs-font-size: 4px }',
      '  }',
      '}',
      ':root:lang(ja) { --vs-font-size: 5px }',
      '@page chapter { --vs-page--margin: 6mm }',
      '@page :left { margin: 0; @bottom-left { content: counter(page) } }',
    ),
  };

  const NAMES = [
    '--vs-font-size',
    '--vs-line-height',
    '--vs-font-family',
    '--vs--h1-font-size',
    '--vs-page--margin',
    '--vs-new',
  ];

  const VALUES = [
    '12pt',
    '\'Foo; Bar}\', "Baz", serif',
    'url(data:image/png;base64,AA//BB==)',
    'calc((1em + 2px) * var(--vs-line-height, 1.5))',
    '{ a: b; c: d }',
  ];

  const squash = (text: string) => text.replace(/\s+/g, '');
  const signature = (text: string) => [...squash(text)].sort().join('');
  const comments = (text: string) => text.match(/\/\*[\s\S]*?\*\//g) ?? [];

  function diff(before: string, after: string) {
    let head = 0;
    while (
      head < Math.min(before.length, after.length) &&
      before[head] === after[head]
    ) {
      head++;
    }
    let tail = 0;
    while (
      tail < Math.min(before.length, after.length) - head &&
      before.at(-1 - tail) === after.at(-1 - tail)
    ) {
      tail++;
    }
    return {
      removed: before.slice(head, before.length - tail),
      added: after.slice(head, after.length - tail),
    };
  }

  function others(
    model: ThemeCssModel,
    scope: ThemeScopeId,
    name: string,
  ): string[] {
    return SCOPE_IDS.flatMap((id) =>
      Object.values(model.scopes[id].variables)
        .filter((v) => id !== scope || v.name !== name)
        .map((v) => `${id} ${v.name}: ${v.value} ${v.important} ${v.count}`),
    );
  }

  function insertions(scope: ThemeScopeId, name: string, value: string) {
    const { rule, media } = THEME_SCOPES.find((s) => s.id === scope) ?? {};
    const declarations = [
      `${name}:${value}`,
      `${name}:${value};`,
      `;${name}:${value}`,
      `;${name}:${value};`,
    ];
    return [
      ...declarations,
      ...declarations.map((d) =>
        media ? `@media ${media}{${rule}{${d}}}` : `${rule}{${d}}`,
      ),
    ].map(signature);
  }

  describe.each(Object.entries(FIXTURES))('%s', (_, css) => {
    const cases = SCOPE_IDS.flatMap((scope) =>
      NAMES.flatMap((name) =>
        VALUES.map((value) => [scope, name, value] as const),
      ),
    );

    it('reports the value that was set and nothing else changes', () => {
      const before = parseThemeCss(css);
      for (const [scope, name, value] of cases) {
        const out = setVariable(css, scope, name, value);
        const after = parseThemeCss(out);
        expect(after.scopes[scope].variables[name]).toMatchObject({
          value,
          count: 1,
        });
        expect(others(after, scope, name)).toEqual(others(before, scope, name));
        expect(after.diagnostics.length).toBe(before.diagnostics.length);
        expect(comments(out)).toEqual(comments(css));
        expect(setVariable(out, scope, name, value)).toBe(out);

        const existing = before.scopes[scope].variables[name];
        if (existing?.count === 1) {
          expect(out).toBe(
            css.slice(0, existing.valueStart) +
              value +
              css.slice(existing.valueEnd),
          );
        } else if (!existing) {
          const { removed, added } = diff(css, out);
          expect(removed.trim()).toBe('');
          expect(insertions(scope, name, value)).toContain(signature(added));
        }
      }
    });

    it('removes a variable and nothing else changes', () => {
      const before = parseThemeCss(css);
      for (const scope of SCOPE_IDS) {
        for (const name of NAMES) {
          const out = removeVariable(css, scope, name);
          const after = parseThemeCss(out);
          expect(after.scopes[scope].variables[name]).toBeUndefined();
          expect(others(after, scope, name)).toEqual(
            others(before, scope, name),
          );
          expect(comments(out)).toEqual(comments(css));
          expect(removeVariable(out, scope, name)).toBe(out);
          if (!before.scopes[scope].variables[name]) {
            expect(out).toBe(css);
          }
        }
      }
    });

    it('undoes an insertion by removing it', () => {
      const before = parseThemeCss(css);
      for (const [scope, name, value] of cases) {
        if (before.scopes[scope].variables[name]) {
          continue;
        }
        const out = removeVariable(
          setVariable(css, scope, name, value),
          scope,
          name,
        );
        // A terminator added to the preceding declaration stays behind.
        expect(squash(out).replaceAll(';', '')).toBe(
          squash(css).replaceAll(';', ''),
        );
      }
    });
  });

  it('holds for randomly assembled, mostly broken stylesheets', () => {
    const chunks = [
      ...[':root {', ':root{', ' }', '}', '\n}\n', ';', ' ', '\n', '\n\n'],
      ...['--vs-a: 1px;', '--vs-a:1px', '\n  --vs-a: 3px !important;'],
      ...['--vs-b: red;', '\n  --vs-b: "x;y";', '--vs-c: url(a;b)'],
      ...['/* c */', '/* --vs-a: 1; */', '/*', '"x', '(', ')', '!', '\r\n'],
      ...['@media print {', '@media screen{', '@page {', '@page :left {'],
      ...['h1 { color: red }', 'h1{color:red}', 'color: blue;', 'colo'],
      ...['@import "a";', '@top-left { content: "x" }', '.a { --vs-a: 9 }'],
    ];
    let seed = 20261115;
    const random = (limit: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % limit;
    };
    const isSubsequence = (needle: string, haystack: string) => {
      let matched = 0;
      for (const c of haystack) {
        matched += c === needle[matched] ? 1 : 0;
      }
      return matched === needle.length;
    };

    let edited = 0;
    for (let i = 0; i < 4000; i++) {
      const css = Array.from(
        { length: 1 + random(14) },
        () => chunks[random(chunks.length)],
      ).join('');
      const scope = SCOPE_IDS[random(SCOPE_IDS.length)];
      const name = random(2) ? '--vs-a' : '--vs-new';
      const before = parseThemeCss(css);

      const removed = removeVariable(css, scope, name);
      const afterRemoval = parseThemeCss(removed);
      expect(afterRemoval.scopes[scope].variables[name], css).toBeUndefined();
      expect(others(afterRemoval, scope, name), css).toEqual(
        others(before, scope, name),
      );
      expect(isSubsequence(squash(removed), squash(css)), css).toBe(true);

      let out: string;
      try {
        out = setVariable(css, scope, name, '2em');
      } catch (error) {
        expect(error, css).toBeInstanceOf(ThemeCssEditError);
        continue;
      }
      edited++;
      const after = parseThemeCss(out);
      expect(after.scopes[scope].variables[name], css).toMatchObject({
        value: '2em',
        count: 1,
      });
      expect(others(after, scope, name), css).toEqual(
        others(before, scope, name),
      );
      if (!before.scopes[scope].variables[name]) {
        expect(isSubsequence(squash(css), squash(out)), css).toBe(true);
      }
    }
    expect(edited).toBeGreaterThan(3000);
  });

  it('restores well-formed stylesheets byte for byte', () => {
    for (const css of [FIXTURES.template, FIXTURES.crlf, FIXTURES.tabs]) {
      for (const scope of SCOPE_IDS) {
        const out = setVariable(css, scope, '--vs-new', '1');
        expect(out).not.toBe(css);
        expect(removeVariable(out, scope, '--vs-new')).toBe(css);
      }
    }
  });

  it('survives a sequence of edits across all scopes', () => {
    let css = FIXTURES.template;
    for (const scope of SCOPE_IDS) {
      for (const name of NAMES) {
        css = setVariable(css, scope, name, `${scope} ${name}`);
      }
    }
    for (const scope of SCOPE_IDS) {
      expect(valuesOf(css, scope)).toMatchObject(
        Object.fromEntries(NAMES.map((name) => [name, `${scope} ${name}`])),
      );
    }
    for (const scope of SCOPE_IDS) {
      for (const name of NAMES) {
        css = removeVariable(css, scope, name);
      }
    }
    const model = parseThemeCss(css);
    expect(SCOPE_IDS.map((id) => model.scopes[id].variables)).toEqual(
      SCOPE_IDS.map(() => ({})),
    );
    // Rules that hold more than variables outlive them.
    expect(SCOPE_IDS.filter((id) => model.scopes[id].exists)).toEqual([
      'root',
      'page',
    ]);
    expect(css).toContain('h1::before {');
    expect(comments(css)).toEqual(comments(FIXTURES.template));
  });
});
