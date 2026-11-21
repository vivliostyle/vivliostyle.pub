import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { parseThemeCss } from './css-model';
import {
  matchesLanguageRange,
  resolveThemeDefaults,
  scanThemeDeclarations,
} from './defaults';
import {
  buildThemeVariableSchema,
  loadThemeVariableSchema,
  type ThemeVariableSchema,
} from './schema';
import { THEME_SCOPES, type ThemeScopeId } from './scopes';

const require = createRequire(import.meta.url);

const themeBaseDir = dirname(
  require.resolve('@vivliostyle/theme-base/package.json'),
);

const readThemeBase = (file: string) =>
  readFileSync(join(themeBaseDir, file), 'utf8');

const schema = buildThemeVariableSchema({
  _basic: {
    'pre-white-space': {
      _syntax: '*',
      _define: [
        { value: 'pre' },
        { value: 'pre-wrap', media: 'print' },
        { value: 'normal', media: 'screen' },
      ],
    },
  },
  figure: {
    label: {
      _syntax: '<string>',
      _define: [
        { value: "'Figure '" },
        { value: "'図'", selector: ':root:lang(ja)' },
      ],
    },
    'font-size': { _syntax: '<length-percentage>', _define: '0.8em' },
    'call-content': { _syntax: '*' },
  },
  page: {
    'mbox-visibility': { _syntax: '*', _define: 'visible' },
  },
});

const LABEL = '--vs-figure--label';
const FONT_SIZE = '--vs-figure--font-size';
const PRE = '--vs--pre-white-space';
const MBOX = '--vs-page--mbox-visibility';
const CALL = '--vs-figure--call-content';

function defaults(
  themeCss?: string,
  {
    language = 'en',
    scope = 'root',
  }: { language?: string; scope?: ThemeScopeId } = {},
) {
  return resolveThemeDefaults({
    schema,
    theme: themeCss === undefined ? undefined : scanThemeDeclarations(themeCss),
    language,
    scope,
  });
}

describe('matchesLanguageRange', () => {
  it.each([
    ['ja', 'ja', true],
    ['ja-JP', 'ja', true],
    ['JA-jp', 'ja-JP', true],
    ['ja', 'ja-JP', false],
    ['jav', 'ja', false],
    ['de-Latn-DE', 'de-DE', true],
    ['de-x-DE', 'de-DE', false],
    ['de-CH', '*-CH', true],
    ['de', '*', true],
    ['en', '', false],
  ])('%s against %j is %s', (language, range, expected) => {
    expect(matchesLanguageRange(language, range)).toBe(expected);
  });
});

describe('resolveThemeDefaults', () => {
  it('reads the documented defaults without a theme', () => {
    const get = defaults();
    expect(get(LABEL)).toBe("'Figure '");
    expect(get(FONT_SIZE)).toBe('0.8em');
    expect(get(CALL)).toBeUndefined();
    expect(get('--vs-unknown')).toBeUndefined();
  });

  it('honours documented `:lang()` defaults for the document language', () => {
    for (const language of ['ja', 'ja-JP', 'JA']) {
      expect(defaults(undefined, { language })(LABEL), language).toBe("'図'");
    }
    for (const language of ['en', 'jav', '']) {
      expect(defaults(undefined, { language })(LABEL), language).toBe(
        "'Figure '",
      );
    }
  });

  it('honours documented media defaults in the matching scope only', () => {
    const scoped = (scope: ThemeScopeId) => defaults(undefined, { scope })(PRE);
    expect(scoped('root')).toBe('pre');
    expect(scoped('print-root')).toBe('pre-wrap');
    expect(scoped('screen-root')).toBe('normal');
  });

  it('prefers what the theme declares', () => {
    const get = defaults(
      ':root{--vs-figure--label:"Fig. ";--vs-figure--call-content:x}',
    );
    expect(get(LABEL)).toBe('"Fig. "');
    expect(get(CALL)).toBe('x');
    expect(get(FONT_SIZE)).toBe('0.8em');
  });

  it('keeps the documented form of a value the bundle only minified', () => {
    const get = defaults(
      ':root{--vs-figure--font-size:.8em;--vs-figure--label:"Figure "}',
    );
    expect(get(FONT_SIZE)).toBe('0.8em');
    expect(get(LABEL)).toBe("'Figure '");
    expect(defaults(':root{--vs-figure--font-size:.85em}')(FONT_SIZE)).toBe(
      '.85em',
    );
  });

  it('follows specificity, then source order, then importance', () => {
    const css = [
      ':root:lang(ja){--a:lang}',
      ':root{--a:root;--b:first}',
      ':root{--b:second}',
      ':root{--c:important!important}',
      ':root:lang(ja){--c:specific}',
      ':where(:root:lang(ja)){--d:where}',
      ':root{--d:root}',
      'html:root{--e:compound}',
      ':is(:root,#x){--e:is}',
    ].join('');
    const get = defaults(css, { language: 'ja' });
    expect(get('--a')).toBe('lang');
    expect(get('--b')).toBe('second');
    expect(get('--c')).toBe('important');
    expect(get('--d')).toBe('root');
    // `:is()` takes the specificity of its most specific argument.
    expect(get('--e')).toBe('is');
    expect(defaults(css, { language: 'en' })('--a')).toBe('root');
  });

  it('matches the selectors a root element can satisfy', () => {
    const get = defaults(
      [
        ':root:lang("ja", en){--a:list}',
        ':root:lang(\\*-JP){--b:wildcard}',
        ':root:not(:lang(ja)){--c:not}',
        'html{--d:type}',
        ':root .x{--e:descendant}',
        ':root>a{--e:child}',
        ':root.dark{--e:class}',
        ':root::before{--e:element}',
        'a:hover{--e:hover}',
        ':is(html,body):is(.part){--e:markup}',
      ].join(''),
      { language: 'ja-JP' },
    );
    expect(get('--a')).toBe('list');
    expect(get('--b')).toBe('wildcard');
    expect(get('--c')).toBeUndefined();
    expect(get('--d')).toBe('type');
    expect(get('--e')).toBeUndefined();
  });

  it('resolves nested rules', () => {
    const css =
      ':root{--a:outer;&:lang(ja){--a:nested};@media print{--b:print}}';
    expect(defaults(css, { language: 'ja' })('--a')).toBe('nested');
    expect(defaults(css, { language: 'en' })('--a')).toBe('outer');
    expect(defaults(css, { scope: 'print-root' })('--b')).toBe('print');
    expect(defaults(css)('--b')).toBeUndefined();
  });

  it('evaluates media types for each scope', () => {
    const css = [
      ':root{--a:any}',
      '@media print{:root{--a:print}}',
      '@media screen{:root{--a:screen}}',
      '@media print,screen{:root{--b:both}}',
      '@media not print{:root{--c:not-print}}',
      '@media all{:root{--d:all}}',
      '@media print and (min-width:10cm){:root{--e:feature}}',
      '@media (hover:hover){:root{--e:hover}}',
    ].join('');
    const scoped = (scope: ThemeScopeId) => defaults(css, { scope });
    expect(['--a', '--b', '--c', '--d', '--e'].map(scoped('root'))).toEqual([
      'any',
      undefined,
      undefined,
      'all',
      undefined,
    ]);
    expect(
      ['--a', '--b', '--c', '--d', '--e'].map(scoped('print-root')),
    ).toEqual(['print', 'both', undefined, 'all', undefined]);
    expect(
      ['--a', '--b', '--c', '--d', '--e'].map(scoped('screen-root')),
    ).toEqual(['screen', 'both', 'not-print', 'all', undefined]);
  });

  it('ranks cascade layers', () => {
    const get = defaults(
      [
        '@layer base,theme;',
        ':root{--a:unlayered}',
        '@layer theme{:root{--a:theme;--b:theme;--c:theme!important;--d:theme}}',
        '@layer base{:root{--b:base;--c:base!important}}',
        '@layer theme.sub{:root{--d:sub}}',
      ].join(''),
    );
    expect(get('--a')).toBe('unlayered');
    expect(get('--b')).toBe('theme');
    expect(get('--c')).toBe('base');
    expect(get('--d')).toBe('theme');
  });

  it('leaves `@supports` and unknown at-rules out', () => {
    const get = defaults(
      '@supports (display:grid){:root{--a:x}}@font-face{--b:x}@page{@top-left{--c:x}}',
      { scope: 'page' },
    );
    expect([get('--a'), get('--b'), get('--c')]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('lets page scopes inherit from the root in print', () => {
    const css =
      ':root{--vs-page--mbox-visibility:root}@media print{:root{--vs-page--mbox-visibility:print}}';
    for (const { id } of THEME_SCOPES.filter((s) => s.rule.startsWith('@'))) {
      expect(defaults(css, { scope: id })(MBOX), id).toBe('print');
    }
    expect(defaults(undefined, { scope: 'page-left' })(MBOX)).toBe('visible');
  });

  it('matches `@page` rules to page scopes', () => {
    const css = [
      ':root{--a:root}',
      '@page :first{--a:first}',
      '@page{--a:page}',
      '@page:left{--a:left}',
      '@page :right,:left{--b:sides}',
      '@page chapter{--c:named}',
      '@page :nth(1){--c:nth}',
      '@page:blank{--c:blank}',
    ].join('');
    const scoped = (scope: ThemeScopeId) =>
      ['--a', '--b', '--c'].map(defaults(css, { scope }));
    expect(scoped('page')).toEqual(['page', undefined, undefined]);
    expect(scoped('page-left')).toEqual(['left', 'sides', undefined]);
    expect(scoped('page-right')).toEqual(['page', 'sides', undefined]);
    expect(scoped('page-first')).toEqual(['first', undefined, undefined]);
    expect(scoped('root')).toEqual(['root', undefined, undefined]);
  });

  it('scans a stylesheet once while it stays the same', () => {
    const css = ':root{--a:1}';
    expect(scanThemeDeclarations(css)).toBe(scanThemeDeclarations(css));
  });
});

describe('resolveThemeDefaults with theme-base', () => {
  let base: ThemeVariableSchema;
  // `theme.css` only imports these, in this order.
  const baseCss = ['css/reset.css', 'css/define.css', 'css/basic.css']
    .map(readThemeBase)
    .join('\n');

  beforeAll(async () => {
    base = await loadThemeVariableSchema();
  });

  const resolve = (
    themeCss: string | undefined,
    language: string | undefined,
    scope: ThemeScopeId = 'root',
  ) =>
    resolveThemeDefaults({
      schema: base,
      theme:
        themeCss === undefined ? undefined : scanThemeDeclarations(themeCss),
      language,
      scope,
    });

  it('switches labels with the document language', () => {
    for (const themeCss of [undefined, baseCss]) {
      expect(resolve(themeCss, 'ja')('--vs-figure--label')).toBe("'図'");
      expect(resolve(themeCss, 'ja-JP')('--vs-table--label')).toBe("'表'");
      expect(resolve(themeCss, 'en')('--vs-figure--label')).toBe("'Figure '");
      expect(resolve(themeCss, undefined)('--vs-figure--label')).toBe(
        "'Figure '",
      );
    }
  });

  it('switches media dependent defaults with the scope', () => {
    for (const themeCss of [undefined, baseCss]) {
      expect(resolve(themeCss, 'en')('--vs--pre-white-space')).toBe('pre');
      expect(
        resolve(themeCss, 'en', 'print-root')('--vs--pre-white-space'),
      ).toBe('pre-wrap');
      expect(
        resolve(themeCss, 'en', 'screen-root')('--vs-figure--call-content'),
      ).toBe("var(--vs-figure--label) '???'");
    }
  });

  it('agrees with what the stylesheets of theme-base declare', () => {
    for (const { id } of THEME_SCOPES) {
      for (const language of ['en', 'ja', undefined]) {
        const documented = resolve(undefined, language, id);
        const declared = resolve(baseCss, language, id);
        for (const { name } of base.variables) {
          expect(declared(name), `${id} ${language} ${name}`).toBe(
            documented(name),
          );
        }
      }
    }
  });

  it('shows what a theme overrides on top of theme-base', () => {
    const prism = readThemeBase('css/prism/theme-okaidia.css');
    const overrides = parseThemeCss(prism).scopes.root.variables;
    const name = '--vs-prism--atrule-text-color';
    expect(overrides[name]).toBeDefined();
    expect(resolve(undefined, 'en')(name)).toBe('var(--vs-prism--text-color)');
    expect(resolve(`${baseCss}\n${prism}`, 'en')(name)).toBe(
      overrides[name].value,
    );
  });
});
